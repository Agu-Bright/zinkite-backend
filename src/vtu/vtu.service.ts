import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { WalletService } from '../wallet/wallet.service';
import { TransactionCategory, TransactionSource } from '../wallet/schemas/wallet-transaction.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { VtpassClient } from './vtpass.client';
import { VtuProductType, VtuTransaction, VtuTransactionDocument, VtuTransactionStatus } from './schemas/vtu-transaction.schema';
import { PurchaseAirtimeDto, PurchaseDataDto, PurchaseElectricityDto, PurchaseTvDto, VtuQueryDto } from './dto/vtu.dto';
import { sortDataPlans } from './vtu-plan-sorter';

const AIRTIME: Record<string, string> = { mtn: 'mtn', glo: 'glo', airtel: 'airtel', etisalat: 'etisalat' };
const DATA: Record<string, string> = { mtn: 'mtn-data', glo: 'glo-data', airtel: 'airtel-data', etisalat: 'etisalat-data' };

@Injectable()
export class VtuService {
  private readonly logger = new Logger(VtuService.name);
  private readonly cache = new Map<string, { expires: number; data: any[] }>();

  constructor(
    @InjectModel(VtuTransaction.name) private readonly transactions: Model<VtuTransactionDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly vtpass: VtpassClient,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
  ) {}

  networks() {
    return [
      { id: 'mtn', name: 'MTN' }, { id: 'glo', name: 'Glo' },
      { id: 'airtel', name: 'Airtel' }, { id: 'etisalat', name: '9mobile' },
    ];
  }

  async variations(serviceId: string) {
    const cached = this.cache.get(serviceId);
    if (cached && cached.expires > Date.now()) return cached.data;
    const providerData = await this.vtpass.variations(serviceId);
    const seen = new Set<string>();
    const data = providerData.filter((item: any) => {
      const code = String(item?.variation_code || '').trim();
      const fallback = `${String(item?.name || '').trim()}|${String(item?.variation_amount || '').trim()}`;
      const key = code || fallback;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    this.cache.set(serviceId, { data, expires: Date.now() + 30 * 60_000 });
    return data;
  }

  async dataPlans(network: string) {
    const serviceId = DATA[network.toLowerCase()];
    if (!serviceId) throw new BadRequestException('Unsupported network');
    return sortDataPlans(await this.variations(serviceId));
  }

  tvBouquets(serviceId: string) {
    if (!['dstv', 'gotv', 'startimes', 'showmax'].includes(serviceId)) throw new BadRequestException('Unsupported TV provider');
    return this.variations(serviceId);
  }

  electricityProviders() { return this.vtpass.services('electricity-bill'); }
  verifyCustomer(serviceId: string, billersCode: string, type?: string) { return this.vtpass.verify(serviceId, billersCode, type); }

  async purchaseAirtime(userId: string, dto: PurchaseAirtimeDto, idempotencyKey?: string) {
    if (idempotencyKey && !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      throw new BadRequestException('Invalid idempotency key');
    }
    const phone = this.normalizeNigerianPhone(dto.phone);
    const result: any = await this.execute(userId, {
      type: VtuProductType.AIRTIME, serviceId: AIRTIME[dto.network], providerName: dto.network.toUpperCase(),
      recipient: phone, phone, amountNaira: dto.amount,
      payload: { phone }, idempotencyKey,
    });
    return this.finalizeInstantPurchase(result, 'Airtime');
  }

  async purchaseData(userId: string, dto: PurchaseDataDto) {
    const serviceId = DATA[dto.network];
    const plan = (await this.variations(serviceId)).find((p) => p.variation_code === dto.variationCode);
    if (!plan) throw new BadRequestException('This data plan is no longer available');
    const amount = Number(plan.variation_amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadGatewayException('Provider returned an invalid plan price');
    const phone = this.normalizeNigerianPhone(dto.phone);
    const result: any = await this.execute(userId, {
      type: VtuProductType.DATA, serviceId, providerName: dto.network.toUpperCase(), recipient: phone,
      phone, amountNaira: amount, variationCode: dto.variationCode, variationName: plan.name,
      payload: { phone, billersCode: phone, variation_code: dto.variationCode },
    });
    return this.finalizeInstantPurchase(result, 'Data');
  }

  /**
   * Airtime and data are instant-delivery products — from the user's
   * perspective they either arrive or they don't. If `execute()` returns
   * anything other than SUCCESS, we throw and let the caller show a plain
   * failure. `execute()` has already refunded the wallet for AIRTIME/DATA
   * when the final state was still PROCESSING, so throwing here doesn't
   * leave any money in limbo.
   */
  private finalizeInstantPurchase(result: any, label: string) {
    if (result?.status === VtuTransactionStatus.SUCCESS) return result;
    const reason = result?.failureReason || `${label} purchase could not be completed. Your wallet has been refunded.`;
    throw new BadGatewayException(reason);
  }

  async purchaseElectricity(userId: string, dto: PurchaseElectricityDto) {
    const user = await this.users.findById(userId);
    const phone = this.normalizeNigerianPhone(String(user?.phone || dto.phone || ''));
    if (!/^0[789]\d{9}$/.test(phone)) {
      throw new BadRequestException('Add a valid phone number to your profile before paying an electricity bill');
    }
    const verification = await this.vtpass.verify(dto.serviceId, dto.meterNumber, dto.meterType);
    return this.execute(userId, {
      type: VtuProductType.ELECTRICITY, serviceId: dto.serviceId, providerName: verification?.content?.Customer_Name,
      recipient: dto.meterNumber, phone, amountNaira: dto.amount, customer: verification?.content,
      payload: { phone, billersCode: dto.meterNumber, variation_code: dto.meterType },
    });
  }

  async purchaseTv(userId: string, dto: PurchaseTvDto) {
    const isShowmax = dto.serviceId === 'showmax';
    const isStartimes = dto.serviceId === 'startimes';
    const [verification, plans] = await Promise.all([
      isShowmax ? Promise.resolve(null) : this.vtpass.verify(dto.serviceId, dto.smartcardNumber),
      this.variations(dto.serviceId),
    ]);
    const plan = plans.find((p) => p.variation_code === dto.variationCode);
    if (!plan) throw new BadRequestException('This bouquet is no longer available');
    const amount = Number(plan.variation_amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadGatewayException('Provider returned an invalid bouquet price');
    const phone = this.normalizeNigerianPhone(isShowmax ? dto.smartcardNumber : dto.phone || '');
    if (!/^0[789]\d{9}$/.test(phone)) {
      throw new BadRequestException(isShowmax ? 'Enter a valid 11-digit Showmax account phone number' : 'Enter a valid notification phone number');
    }
    const result: any = await this.execute(userId, {
      type: VtuProductType.TV, serviceId: dto.serviceId, providerName: isShowmax ? 'Showmax' : dto.serviceId.toUpperCase(),
      recipient: isShowmax ? phone : dto.smartcardNumber, phone, amountNaira: amount, customer: verification?.content,
      variationCode: dto.variationCode, variationName: plan.name,
      payload: isShowmax
        // VTpass's live TV purchase handler uses the common TV argument
        // shape even though the Showmax documentation omits `phone` from its
        // field table. This matches the proven Cardviro implementation.
        ? { phone, billersCode: phone, variation_code: dto.variationCode }
        : isStartimes
          ? { phone, billersCode: dto.smartcardNumber, variation_code: dto.variationCode }
          : { phone, billersCode: dto.smartcardNumber, variation_code: dto.variationCode, subscription_type: 'change' },
    });
    if (result?.status === VtuTransactionStatus.SUCCESS || result?.status === VtuTransactionStatus.PROCESSING) {
      return result;
    }
    throw new BadGatewayException(
      result?.failureReason || 'TV subscription failed. Your wallet has been refunded.',
    );
  }

  /**
   * VTpass request_id format:
   *   YYYYMMDDHHMM<random-suffix>
   *
   * VTpass docs are strict — the timestamp prefix MUST reflect current time
   * in the Africa/Lagos (UTC+1) timezone. If the server clock is on UTC
   * (which Coolify / most cloud hosts default to) and we use local time, the
   * timestamp is an hour behind Lagos and VTpass rejects the request with
   * 401 / "Invalid Credentials" — the very error we've been seeing.
   *
   * Mirrors Cardviro's `generateRequestId` exactly.
   */
  private requestId(): string {
    const now = new Date();
    const lagosTime = new Date(now.getTime() + 60 * 60 * 1000); // UTC+1
    const y = lagosTime.getUTCFullYear().toString();
    const mo = String(lagosTime.getUTCMonth() + 1).padStart(2, '0');
    const d = String(lagosTime.getUTCDate()).padStart(2, '0');
    const h = String(lagosTime.getUTCHours()).padStart(2, '0');
    const mi = String(lagosTime.getUTCMinutes()).padStart(2, '0');
    const suffix = crypto.randomBytes(6).toString('hex');
    return `${y}${mo}${d}${h}${mi}${suffix}`;
  }

  /**
   * Normalize a Nigerian phone number to VTpass's expected local format
   * (`0XXXXXXXXXX`). VTpass rejects international-format numbers (`+234...`)
   * on `/pay`, so we always convert to local before dispatch.
   * Mirrors Cardviro's `formatPhoneNumber`.
   */
  private normalizeNigerianPhone(phone: string): string {
    let p = String(phone || '').replace(/[\s\-\+]/g, '');
    if (p.startsWith('234') && p.length === 13) p = '0' + p.slice(3);
    if (!p.startsWith('0') && p.length === 10) p = '0' + p;
    return p;
  }

  private category(type: VtuProductType) {
    if (type === VtuProductType.AIRTIME) return TransactionCategory.AIRTIME;
    if (type === VtuProductType.DATA) return TransactionCategory.DATA;
    if (type === VtuProductType.ELECTRICITY) return TransactionCategory.ELECTRICITY;
    return TransactionCategory.TV;
  }

  private async execute(userId: string, input: any) {
    if (input.idempotencyKey) {
      const existing = await this.transactions.findOne({ userId: new Types.ObjectId(userId), idempotencyKey: input.idempotencyKey });
      if (existing) {
        const samePurchase = existing.type === input.type
          && existing.serviceId === input.serviceId
          && existing.recipient === input.recipient
          && existing.amount === Math.round(input.amountNaira * 100);
        if (!samePurchase) throw new BadRequestException('Idempotency key has already been used for another purchase');
        return existing;
      }
    }

    if (input.type === VtuProductType.AIRTIME) {
      const duplicateWindow = new Date(Date.now() - 30_000);
      const recentDuplicate = await this.transactions.findOne({
        userId: new Types.ObjectId(userId), type: input.type,
        serviceId: input.serviceId, recipient: input.recipient,
        amount: Math.round(input.amountNaira * 100), createdAt: { $gte: duplicateWindow },
      }).sort({ createdAt: -1 });
      if (recentDuplicate) return recentDuplicate;
    }

    const amount = Math.round(input.amountNaira * 100);
    const requestId = this.requestId();
    const reference = `VTU-${input.type}-${requestId}`;
    const session = await this.connection.startSession();
    let purchase: VtuTransactionDocument;
    try {
      session.startTransaction();
      [purchase] = await this.transactions.create([{ userId: new Types.ObjectId(userId), ...input, amount, requestId, reference, status: VtuTransactionStatus.PENDING }], { session });
      const debit = await this.wallet.debitWallet({ userId, amount, category: this.category(input.type), source: TransactionSource.VTU_VTPASS, narration: `${input.providerName || input.serviceId} ${input.type.toLowerCase()} purchase`, reference, relatedId: purchase._id, session });
      purchase.walletTransactionId = (debit as any)._id;
      await purchase.save({ session });
      await session.commitTransaction();
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally { session.endSession(); }

    // Products that MUST resolve to SUCCESS or REFUNDED in the request lifecycle
    // (never leave the client staring at "processing"). Cardviro parity.
    const isInstantDelivery =
      input.type === VtuProductType.AIRTIME || input.type === VtuProductType.DATA;

    try {
      const response = await this.vtpass.pay({
        request_id: requestId,
        serviceID: input.serviceId,
        amount: input.amountNaira,
        ...input.payload,
      });
      let result: any = await this.applyProviderResult(purchase!._id.toString(), response);

      // Airtime/data are immediate-delivery products. VTpass can initially return
      // 099/initiated before the network confirms delivery, so requery briefly
      // before responding to the app. Only a delivered transaction is SUCCESS.
      if (isInstantDelivery && result?.status === VtuTransactionStatus.PROCESSING) {
        result = await this.awaitFinalState(purchase!._id.toString(), requestId, result);
      }

      // If we still can't confirm delivery for airtime/data after the retry
      // window, treat as failed and refund. The user should never see these
      // types stuck in PROCESSING in their history.
      if (isInstantDelivery && result?.status === VtuTransactionStatus.PROCESSING) {
        return this.refund(
          purchase!._id.toString(),
          'Delivery could not be confirmed. Your wallet has been refunded — please try again.',
        );
      }

      return result;
    } catch (error) {
      if (this.vtpass.isDefinitiveFailure(error)) return this.refund(purchase!._id.toString(), error.response?.data?.response_description || 'Provider rejected transaction');
      // For instant-delivery products, an unknown provider error still needs
      // a clean outcome — refund and mark REFUNDED rather than leaving it in
      // limbo. Electricity and TV can safely stay in PROCESSING because their
      // async delivery model matches how the user thinks about them.
      if (isInstantDelivery) {
        return this.refund(
          purchase!._id.toString(),
          (error as Error)?.message || 'Provider did not respond. Your wallet has been refunded.',
        );
      }
      await this.transactions.findByIdAndUpdate(purchase!._id, { status: VtuTransactionStatus.PROCESSING, failureReason: 'Awaiting provider confirmation' });
      return this.transactions.findById(purchase!._id);
    }
  }

  private async awaitFinalState(
    transactionId: string,
    requestId: string,
    initial: any,
  ): Promise<any> {
    let result: any = initial;
    for (const delayMs of [800, 1500, 2500]) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        const response = await this.vtpass.requery(requestId);
        result = await this.applyProviderResult(transactionId, response);
        if (![VtuTransactionStatus.PENDING, VtuTransactionStatus.PROCESSING].includes(result.status)) break;
      } catch (error) {
        this.logger.warn(`Immediate requery failed for ${requestId}: ${(error as Error).message}`);
      }
    }
    return result;
  }

  private providerState(response: any): 'success' | 'pending' | 'failed' {
    const code = String(response?.code || '');
    const status = String(response?.content?.transactions?.status || '').toLowerCase();
    // VTpass documents one definitive purchase success state for airtime:
    // envelope code 000 AND content.transactions.status = delivered.
    // A 000 response without `delivered` must never be reported as success.
    if (code === '000' && status === 'delivered') return 'success';
    if (['pending', 'initiated', 'processing'].includes(status) || ['099', '001'].includes(code)) return 'pending';
    return 'failed';
  }

  private async applyProviderResult(id: string, response: any) {
    const state = this.providerState(response);
    if (state === 'failed') {
      const validationDetails = response?.content?.errors;
      const detail = validationDetails
        ? Object.values(validationDetails).flat().map(String).join(', ')
        : '';
      const reason = [response?.response_description || response?.message || 'Provider rejected transaction', detail]
        .filter(Boolean)
        .join(': ');
      return this.refund(id, reason, response);
    }
    const commissionNaira = Number(
      response?.content?.transactions?.commission_details?.amount ??
      response?.content?.transactions?.commission ?? 0,
    );
    const update: any = {
      providerResponse: response,
      providerReference: response?.content?.transactions?.transactionId || response?.requestId,
      providerCommission: Number.isFinite(commissionNaira) ? Math.round(commissionNaira * 100) : 0,
    };
    if (state === 'success') Object.assign(update, { status: VtuTransactionStatus.SUCCESS, completedAt: new Date(), purchasedCode: response?.purchased_code, units: response?.token || response?.units });
    else update.status = VtuTransactionStatus.PROCESSING;
    const txn = await this.transactions.findByIdAndUpdate(id, update, { new: true });
    if (state === 'success' && txn) this.notifications.sendToUser(txn.userId.toString(), 'Payment successful', `Your ${txn.type.toLowerCase()} purchase was successful.`, { type: 'vtu', transactionId: id }).catch(() => undefined);
    return txn;
  }

  async refund(id: string, reason = 'Transaction failed', response?: any) {
    const session = await this.connection.startSession();
    try {
      session.startTransaction();
      const txn = await this.transactions.findOne({ _id: id, status: { $in: [VtuTransactionStatus.PENDING, VtuTransactionStatus.PROCESSING, VtuTransactionStatus.FAILED] } }).session(session);
      if (!txn) {
        const existing = await this.transactions.findById(id);
        if (!existing) throw new NotFoundException('VTU transaction not found');
        return existing;
      }
      const refund = await this.wallet.creditWallet({ userId: txn.userId, amount: txn.amount, category: TransactionCategory.REFUND, source: TransactionSource.VTU_VTPASS, narration: `Refund for ${txn.reference}`, reference: `${txn.reference}-REFUND`, relatedId: txn._id, session });
      txn.status = VtuTransactionStatus.REFUNDED; txn.failureReason = reason; txn.refundTransactionId = (refund as any)._id;
      if (response) txn.providerResponse = response;
      await txn.save({ session });
      await session.commitTransaction();
      this.notifications.sendToUser(txn.userId.toString(), 'Payment refunded', `Your unsuccessful ${txn.type.toLowerCase()} payment has been returned to your wallet.`, { type: 'vtu', transactionId: id }).catch(() => undefined);
      return txn;
    } catch (error) { await session.abortTransaction(); throw error; } finally { session.endSession(); }
  }

  async requery(id: string, userId?: string) {
    const filter: any = { _id: id };
    if (userId) filter.userId = new Types.ObjectId(userId);
    const txn = await this.transactions.findOne(filter);
    if (!txn) throw new NotFoundException('VTU transaction not found');
    if (![VtuTransactionStatus.PENDING, VtuTransactionStatus.PROCESSING].includes(txn.status)) return txn;
    try {
      const result = await this.vtpass.requery(txn.requestId);
      await this.transactions.findByIdAndUpdate(id, { $inc: { requeryCount: 1 }, lastRequeryAt: new Date() });
      return this.applyProviderResult(id, result);
    } catch (error) { this.logger.warn(`Requery failed for ${txn.reference}: ${error.message}`); return txn; }
  }

  async handleWebhook(payload: any) {
    if (payload?.type === 'variation-update') this.cache.clear();
    const requestId = payload?.data?.request_id || payload?.data?.requestId || payload?.request_id;
    if (!requestId) return;
    const txn = await this.transactions.findOne({ requestId }).select('_id');
    // Never trust an unauthenticated callback for financial state. The callback
    // only triggers a signed server-to-server requery using our secret key.
    if (txn) await this.requery(txn._id.toString());
  }

  @Cron('*/5 * * * *')
  async reconcilePending() {
    const pending = await this.transactions.find({ status: { $in: [VtuTransactionStatus.PENDING, VtuTransactionStatus.PROCESSING] }, updatedAt: { $lte: new Date(Date.now() - 2 * 60_000) } }).sort({ updatedAt: 1 }).limit(50).select('_id');
    for (const txn of pending) await this.requery(txn._id.toString());
  }

  async list(query: VtuQueryDto, userId?: string) {
    const filter: any = {};
    if (userId) filter.userId = new Types.ObjectId(userId); else if (query.userId) filter.userId = new Types.ObjectId(query.userId);
    if (query.type) filter.type = query.type; if (query.status) filter.status = query.status;
    const page = Number(query.page || 1), limit = Number(query.limit || 20);
    const [data, total] = await Promise.all([this.transactions.find(filter).populate('userId', 'firstName lastName email phone').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), this.transactions.countDocuments(filter)]);
    return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid VTU transaction ID');
    const transaction = await this.transactions
      .findById(id)
      .populate('userId', 'firstName lastName fullName email phone')
      .populate('walletTransactionId')
      .populate('refundTransactionId');
    if (!transaction) throw new NotFoundException('VTU transaction not found');
    return transaction;
  }

  async stats() {
    const rows = await this.transactions.aggregate([
      {
        $addFields: {
          calculatedCommission: {
            $ifNull: [
              '$providerCommission',
              {
                $multiply: [
                  {
                    $convert: {
                      input: { $ifNull: ['$providerResponse.content.transactions.commission_details.amount', '$providerResponse.content.transactions.commission'] },
                      to: 'double', onError: 0, onNull: 0,
                    },
                  },
                  100,
                ],
              },
            ],
          },
        },
      },
      { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 }, amount: { $sum: '$amount' }, commission: { $sum: '$calculatedCommission' } } },
    ]);
    return rows;
  }
}
