/**
 * Kora Pay Service
 *
 * Wraps the Kora (Korapay) merchant REST API:
 *  - Collections: initialize charge (hosted checkout), verify charge, virtual bank accounts
 *  - Payouts: disburse (bank transfer), verify payout
 *  - Misc: resolve bank account (name enquiry), list banks
 *  - Webhook signature verification
 *
 * Docs: https://docs.korapay.com  | Base: https://api.korapay.com/merchant/api/v1
 */
import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import {
  KorapayTransaction,
  KorapayTransactionDocument,
  KorapayTransactionStatus,
  KorapayTransactionType,
} from './schemas/korapay-transaction.schema';

export interface InitializeChargeParams {
  email: string;
  name?: string;
  amount: number; // In NGN (major units — Kora uses major units, NOT kobo)
  reference: string;
  redirectUrl?: string;
  notificationUrl?: string;
  metadata?: Record<string, any>;
}

export interface InitializeChargeResult {
  checkoutUrl: string;
  reference: string;
}

export interface VerifyChargeResult {
  success: boolean;
  amount: number; // In NGN (major units)
  reference: string;
  status: string;
  channel?: string;
  paidAt?: Date;
}

export interface DisburseParams {
  reference: string;
  amount: number; // In NGN (major units)
  bankCode: string;
  accountNumber: string;
  accountName: string;
  customerEmail: string;
  customerName?: string;
  narration?: string;
}

export interface DisburseResult {
  success: boolean;
  reference: string;
  status: string;
}

@Injectable()
export class KorapayService {
  private readonly logger = new Logger(KorapayService.name);
  private readonly apiClient: AxiosInstance;
  private readonly secretKey: string;
  private readonly publicKey: string;
  private readonly webhookSecret: string;

  constructor(
    @InjectModel(KorapayTransaction.name)
    private readonly korapayTxnModel: Model<KorapayTransactionDocument>,
    private readonly configService: ConfigService,
  ) {
    this.secretKey = this.configService.get<string>('KORAPAY_SECRET_KEY') || '';
    this.publicKey = this.configService.get<string>('KORAPAY_PUBLIC_KEY') || '';
    // Kora signs webhooks with the secret key; allow an override for rotation.
    this.webhookSecret =
      this.configService.get<string>('KORAPAY_WEBHOOK_SECRET') || this.secretKey;

    const baseUrl =
      this.configService.get<string>('KORAPAY_BASE_URL') ||
      'https://api.korapay.com/merchant/api/v1';

    this.apiClient = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    this.apiClient.interceptors.response.use(
      (response) => {
        this.logger.debug(`Kora Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        this.logger.error(
          `Kora Error: ${error.message}`,
          JSON.stringify(error.response?.data),
        );
        return Promise.reject(error);
      },
    );
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  // ============================================
  // COLLECTIONS (TOPUP)
  // ============================================

  /**
   * Initialize a Kora hosted checkout charge.
   * Returns a checkout_url the client loads in a WebView.
   */
  async initializeCharge(
    params: InitializeChargeParams,
  ): Promise<InitializeChargeResult> {
    try {
      const response = await this.apiClient.post('/charges/initialize', {
        amount: params.amount,
        currency: 'NGN',
        reference: params.reference,
        notification_url: params.notificationUrl,
        redirect_url: params.redirectUrl,
        merchant_bears_cost: false,
        customer: {
          email: params.email,
          name: params.name || params.email,
        },
        metadata: params.metadata,
      });

      const data = response.data?.data || {};
      this.logger.log(`Kora charge initialized: ${params.reference}`);

      return {
        checkoutUrl: data.checkout_url,
        reference: data.reference || params.reference,
      };
    } catch (error) {
      this.logger.error('Failed to initialize Kora charge', error.response?.data);
      throw new InternalServerErrorException('Failed to initialize payment');
    }
  }

  /**
   * Verify a charge by reference.
   */
  async verifyCharge(reference: string): Promise<VerifyChargeResult> {
    try {
      const response = await this.apiClient.get(
        `/charges/${encodeURIComponent(reference)}`,
      );
      const data = response.data?.data || {};
      const success = data.status === 'success';

      return {
        success,
        amount: Number(data.amount) || 0,
        reference: data.reference || reference,
        status: data.status,
        channel: data.payment_method || data.channel,
        paidAt: data.paid_at ? new Date(data.paid_at) : undefined,
      };
    } catch (error) {
      this.logger.error('Failed to verify Kora charge', error.response?.data);
      return { success: false, amount: 0, reference, status: 'failed' };
    }
  }

  /**
   * Create a dedicated virtual bank account for a user (collections via transfer).
   */
  async createVirtualAccount(params: {
    accountReference: string;
    accountName: string;
    customerEmail: string;
    customerName: string;
    bvn?: string;
  }): Promise<{
    accountName: string;
    accountNumber: string;
    bankName: string;
    bankCode: string;
    accountReference: string;
    rawResponse: Record<string, any>;
  }> {
    try {
      const response = await this.apiClient.post('/virtual-bank-account', {
        account_name: params.accountName,
        account_reference: params.accountReference,
        permanent: true,
        bank_code: '000', // Kora assigns the partner bank; 000 = Kora default
        customer: {
          name: params.customerName,
          email: params.customerEmail,
        },
        ...(params.bvn && { bvn: params.bvn }),
      });

      const data = response.data?.data || {};
      this.logger.log(`Kora VBA created: ${data.account_number} for ${params.customerEmail}`);

      return {
        accountName: data.account_name,
        accountNumber: data.account_number,
        bankName: data.bank_name,
        bankCode: data.bank_code,
        accountReference: data.account_reference || params.accountReference,
        rawResponse: data,
      };
    } catch (error) {
      this.logger.error('Failed to create Kora VBA', error.response?.data);
      throw new InternalServerErrorException('Failed to create virtual account');
    }
  }

  // ============================================
  // PAYOUTS (WITHDRAWAL)
  // ============================================

  /**
   * Resolve (name-enquiry) a bank account before payout.
   */
  async resolveBankAccount(params: {
    bankCode: string;
    accountNumber: string;
  }): Promise<{ accountName: string; accountNumber: string }> {
    const response = await this.apiClient.post('/misc/banks/resolve', {
      bank: params.bankCode,
      account: params.accountNumber,
    });
    const data = response.data?.data || {};
    return {
      accountName: data.account_name,
      accountNumber: data.account_number || params.accountNumber,
    };
  }

  /**
   * Fetch the list of supported Nigerian banks.
   */
  async listBanks(): Promise<Array<{ name: string; code: string }>> {
    try {
      const response = await this.apiClient.get('/misc/banks?countryCode=NG');
      return (response.data?.data || []).map((b: any) => ({
        name: b.name,
        code: b.code,
      }));
    } catch (error) {
      this.logger.error('Failed to fetch Kora banks list', error.response?.data);
      throw new InternalServerErrorException('Could not fetch banks list');
    }
  }

  /**
   * Disburse a payout to a bank account.
   */
  async disburse(params: DisburseParams): Promise<DisburseResult> {
    try {
      const response = await this.apiClient.post('/transactions/disburse', {
        reference: params.reference,
        destination: {
          type: 'bank_account',
          amount: params.amount,
          currency: 'NGN',
          narration: params.narration || 'Zinkitex withdrawal',
          bank_account: {
            bank: params.bankCode,
            account: params.accountNumber,
          },
          customer: {
            name: params.customerName || params.accountName,
            email: params.customerEmail,
          },
        },
      });

      const data = response.data?.data || {};
      this.logger.log(`Kora disburse initiated: ${params.reference} -> ${data.status}`);

      return {
        success: data.status === 'success' || data.status === 'processing',
        reference: data.reference || params.reference,
        status: data.status,
      };
    } catch (error) {
      this.logger.error('Failed to disburse via Kora', error.response?.data);
      throw new InternalServerErrorException(
        error.response?.data?.message || 'Failed to initiate transfer',
      );
    }
  }

  /**
   * Verify a payout by reference.
   */
  async verifyDisbursement(
    reference: string,
  ): Promise<{ success: boolean; status: string }> {
    try {
      const response = await this.apiClient.get(
        `/transactions/${encodeURIComponent(reference)}`,
      );
      const data = response.data?.data || {};
      return { success: data.status === 'success', status: data.status };
    } catch (error) {
      this.logger.error('Failed to verify Kora disbursement', error.response?.data);
      return { success: false, status: 'failed' };
    }
  }

  // ============================================
  // WEBHOOK
  // ============================================

  /**
   * Verify a Kora webhook signature.
   * Kora signs the JSON-stringified `data` object with HMAC-SHA256(secretKey).
   */
  verifyWebhookSignature(dataObject: any, signature: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('Kora webhook secret not configured');
      return false;
    }
    if (!signature) return false;

    const computed = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(JSON.stringify(dataObject))
      .digest('hex');

    // constant-time compare
    const a = Buffer.from(computed);
    const b = Buffer.from(signature);
    if (a.length !== b.length) {
      this.logger.warn('Kora webhook signature length mismatch');
      return false;
    }
    const valid = crypto.timingSafeEqual(a, b);
    if (!valid) {
      this.logger.warn(
        `Kora signature mismatch — computed: ${computed.substring(0, 16)}..., received: ${signature.substring(0, 16)}...`,
      );
    }
    return valid;
  }

  // ============================================
  // TRANSACTION RECORDS
  // ============================================

  async createTransactionRecord(params: {
    userId: string | Types.ObjectId;
    reference: string;
    amount: number; // kobo
    type: KorapayTransactionType;
    checkoutUrl?: string;
    metadata?: Record<string, any>;
  }): Promise<KorapayTransactionDocument> {
    const txn = new this.korapayTxnModel({
      userId: new Types.ObjectId(params.userId),
      reference: params.reference,
      amount: params.amount,
      type: params.type,
      status: KorapayTransactionStatus.PENDING,
      checkoutUrl: params.checkoutUrl,
      metadata: params.metadata,
    });
    return txn.save();
  }

  async updateTransactionFromWebhook(
    reference: string,
    webhookData: Record<string, any>,
  ): Promise<KorapayTransactionDocument | null> {
    const data = webhookData.data || {};
    const status =
      data.status === 'success'
        ? KorapayTransactionStatus.SUCCESS
        : data.status === 'abandoned'
          ? KorapayTransactionStatus.ABANDONED
          : KorapayTransactionStatus.FAILED;

    return this.korapayTxnModel.findOneAndUpdate(
      { reference },
      {
        status,
        channel: data.payment_method || data.channel,
        gatewayResponse: data.message || data.gateway_response,
        paidAt: data.paid_at ? new Date(data.paid_at) : undefined,
        rawWebhookEvent: webhookData,
      },
      { new: true },
    );
  }

  async getTransactionByReference(
    reference: string,
  ): Promise<KorapayTransactionDocument | null> {
    return this.korapayTxnModel.findOne({ reference }).exec();
  }

  async isTransactionProcessed(reference: string): Promise<boolean> {
    const txn = await this.getTransactionByReference(reference);
    return txn?.status === KorapayTransactionStatus.SUCCESS;
  }
}
