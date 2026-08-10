import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { WalletService } from '../wallet/wallet.service';
import { TransactionCategory, TransactionSource } from '../wallet/schemas/wallet-transaction.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { VtpassClient } from './vtpass.client';
import { VtuProductType, VtuTransaction, VtuTransactionDocument, VtuTransactionStatus } from './schemas/vtu-transaction.schema';
import { PurchaseAirtimeDto, PurchaseDataDto, PurchaseElectricityDto, PurchaseTvDto, VtuQueryDto } from './dto/vtu.dto';

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
    const data = await this.vtpass.variations(serviceId);
    this.cache.set(serviceId, { data, expires: Date.now() + 30 * 60_000 });
    return data;
  }

  dataPlans(network: string) {
    const serviceId = DATA[network.toLowerCase()];
    if (!serviceId) throw new BadRequestException('Unsupported network');
    return this.variations(serviceId);
  }

  tvBouquets(serviceId: string) {
    if (!['dstv', 'gotv', 'startimes'].includes(serviceId)) throw new BadRequestException('Unsupported TV provider');
    return this.variations(serviceId);
  }

  electricityProviders() { return this.vtpass.services('electricity-bill'); }
  verifyCustomer(serviceId: string, billersCode: string, type?: string) { return this.vtpass.verify(serviceId, billersCode, type); }

  async purchaseAirtime(userId: string, dto: PurchaseAirtimeDto, idempotencyKey?: string) {
    if (idempotencyKey && !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey)) {
      throw new BadRequestException('Invalid idempotency key');
    }
    const result: any = await this.execute(userId, {
      type: VtuProductType.AIRTIME, serviceId: AIRTIME[dto.network], providerName: dto.network.toUpperCase(),
      recipient: dto.phone, phone: dto.phone, amountNaira: dto.amount,
      payload: { phone: dto.phone }, idempotencyKey,
    });

    if (result?.status === VtuTransactionStatus.SUCCESS) return result;

    if ([VtuTransactionStatus.FAILED, VtuTransactionStatus.REFUNDED].includes(result?.status)) {
      throw new BadGatewayException(result?.failureReason || 'Airtime purchase failed. Your wallet was not charged.');
    }

    // Do not expose PENDING/PROCESSING as a purchase outcome. The transaction
    // remains under server-side reconciliation so it can be resolved safely,
    // but the client receives a clear error and must not report a purchase.
    throw new BadGatewayException(
      'Airtime delivery could not be confirmed. Please check your transaction history before trying again.',
    );
  }

  async purchaseData(userId: string, dto: PurchaseDataDto) {
    const serviceId = DATA[dto.network];
    const plan = (await this.variations(serviceId)).find((p) => p.variation_code === dto.variationCode);
    if (!plan) throw new BadRequestException('This data plan is no longer available');
    const amount = Number(plan.variation_amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadGatewayException('Provider returned an invalid plan price');
    return this.execute(userId, {
      type: VtuProductType.DATA, serviceId, providerName: dto.network.toUpperCase(), recipient: dto.phone,
      phone: dto.phone, amountNaira: amount, variationCode: dto.variationCode, variationName: plan.name,
      payload: { phone: dto.phone, billersCode: dto.phone, variation_code: dto.variationCode },
    });
  }

  async purchaseElectricity(userId: string, dto: PurchaseElectricityDto) {
    const verification = await this.vtpass.verify(dto.serviceId, dto.meterNumber, dto.meterType);
    return this.execute(userId, {
      type: VtuProductType.ELECTRICITY, serviceId: dto.serviceId, providerName: verification?.content?.Customer_Name,
      recipient: dto.meterNumber, phone: dto.phone, amountNaira: dto.amount, customer: verification?.content,
      payload: { phone: dto.phone, billersCode: dto.meterNumber, variation_code: dto.meterType },
    });
  }

  async purchaseTv(userId: string, dto: PurchaseTvDto) {
    const [verification, plans] = await Promise.all([
      this.vtpass.verify(dto.serviceId, dto.smartcardNumber), this.variations(dto.serviceId),
    ]);
    const plan = plans.find((p) => p.variation_code === dto.variationCode);
    if (!plan) throw new BadRequestException('This bouquet is no longer available');
    const amount = Number(plan.variation_amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadGatewayException('Provider returned an invalid bouquet price');
    return this.execute(userId, {
      type: VtuProductType.TV, serviceId: dto.serviceId, providerName: dto.serviceId.toUpperCase(),
      recipient: dto.smartcardNumber, phone: dto.phone, amountNaira: amount, customer: verification?.content,
      variationCode: dto.variationCode, variationName: plan.name,
      payload: { phone: dto.phone, billersCode: dto.smartcardNumber, variation_code: dto.variationCode, subscription_type: 'change' },
    });
  }

  private requestId() {
    const d = new Date();
    const stamp = [d.getFullYear(), `${d.getMonth() + 1}`.padStart(2, '0'), `${d.getDate()}`.padStart(2, '0'), `${d.getHours()}`.padStart(2, '0'), `${d.getMinutes()}`.padStart(2, '0')].join('');
    return `${stamp}${Math.floor(10000000 + Math.random() * 90000000)}`;
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

    try {
      const response = await this.vtpass.pay({ request_id: requestId, serviceID: input.serviceId, amount: input.amountNaira, ...input.payload });
      let result: any = await this.applyProviderResult(purchase!._id.toString(), response);

      // Airtime is an immediate-delivery product. VTpass can initially return
      // 099/initiated before the network confirms delivery, so requery briefly
      // before responding to the app. Only a delivered transaction is SUCCESS.
      if (input.type === VtuProductType.AIRTIME && result?.status === VtuTransactionStatus.PROCESSING) {
        result = await this.awaitAirtimeFinalState(purchase!._id.toString(), requestId, result);
      }

      return result;
    } catch (error) {
      if (this.vtpass.isDefinitiveFailure(error)) return this.refund(purchase!._id.toString(), error.response?.data?.response_description || 'Provider rejected transaction');
      await this.transactions.findByIdAndUpdate(purchase!._id, { status: VtuTransactionStatus.PROCESSING, failureReason: 'Awaiting provider confirmation' });
      return this.transactions.findById(purchase!._id);
    }
  }

  private async awaitAirtimeFinalState(
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
        this.logger.warn(`Immediate airtime requery failed for ${requestId}: ${(error as Error).message}`);
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
    if (state === 'failed') return this.refund(id, response?.response_description || 'Provider rejected transaction', response);
    const update: any = { providerResponse: response, providerReference: response?.content?.transactions?.transactionId || response?.requestId };
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

  async stats() {
    const rows = await this.transactions.aggregate([{ $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 }, amount: { $sum: '$amount' } } }]);
    return rows;
  }
}
