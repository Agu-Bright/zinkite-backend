/**
 * Paystack Service
 * 
 * Handles integration with Paystack payment gateway:
 * - Initialize transactions
 * - Verify transactions
 * - Webhook signature verification
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import {
  PaystackTransaction,
  PaystackTransactionDocument,
  PaystackTransactionStatus,
} from './schemas/paystack-transaction.schema';

export interface InitializeTransactionParams {
  email: string;
  amount: number; // In kobo
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, any>;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface VerifyTransactionResult {
  success: boolean;
  amount: number; // In kobo
  reference: string;
  status: string;
  channel?: string;
  paidAt?: Date;
  gatewayResponse?: string;
}

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly apiClient: AxiosInstance;
  private readonly secretKey: string;
  private readonly webhookSecret: string;

  constructor(
    @InjectModel(PaystackTransaction.name)
    private readonly paystackTxnModel: Model<PaystackTransactionDocument>,
    private readonly configService: ConfigService,
  ) {
    this.secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY') || '';
    this.webhookSecret = this.configService.get<string>('PAYSTACK_WEBHOOK_SECRET') || this.secretKey;
    
    const baseUrl = this.configService.get<string>('PAYSTACK_BASE_URL') || 'https://api.paystack.co';

    this.apiClient = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Request/response logging (sanitized)
    this.apiClient.interceptors.request.use((config) => {
      this.logger.debug(`Paystack Request: ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });

    this.apiClient.interceptors.response.use(
      (response) => {
        this.logger.debug(`Paystack Response: ${response.status}`);
        return response;
      },
      (error) => {
        this.logger.error(`Paystack Error: ${error.message}`, error.response?.data);
        return Promise.reject(error);
      },
    );
  }

  /**
   * Initialize a Paystack transaction
   */
  async initializeTransaction(
    params: InitializeTransactionParams,
  ): Promise<InitializeTransactionResult> {
    try {
      const response = await this.apiClient.post('/transaction/initialize', {
        email: params.email,
        amount: params.amount,
        reference: params.reference,
        callback_url: params.callbackUrl,
        metadata: params.metadata,
      });

      const data = response.data.data;

      this.logger.log(`Paystack transaction initialized: ${params.reference}`);

      return {
        authorizationUrl: data.authorization_url,
        accessCode: data.access_code,
        reference: data.reference,
      };
    } catch (error) {
      this.logger.error('Failed to initialize Paystack transaction', error);
      throw new InternalServerErrorException('Failed to initialize payment');
    }
  }

  /**
   * Verify a Paystack transaction
   */
  async verifyTransaction(reference: string): Promise<VerifyTransactionResult> {
    try {
      const response = await this.apiClient.get(
        `/transaction/verify/${encodeURIComponent(reference)}`,
      );

      const data = response.data.data;
      const success = data.status === 'success';

      this.logger.log(
        `Paystack transaction verified: ${reference}, status: ${data.status}`,
      );

      return {
        success,
        amount: data.amount,
        reference: data.reference,
        status: data.status,
        channel: data.channel,
        paidAt: data.paid_at ? new Date(data.paid_at) : undefined,
        gatewayResponse: data.gateway_response,
      };
    } catch (error) {
      this.logger.error('Failed to verify Paystack transaction', error);
      return {
        success: false,
        amount: 0,
        reference,
        status: 'failed',
      };
    }
  }

  /**
   * Verify Paystack webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('Paystack webhook secret not configured');
      return false;
    }

    const hash = crypto
      .createHmac('sha512', this.webhookSecret)
      .update(payload)
      .digest('hex');

    const isValid = hash === signature;

    if (!isValid) {
      // Debug: log which secret source is being used (masked) and hash comparison
      const secretSource = this.configService.get<string>('PAYSTACK_WEBHOOK_SECRET')
        ? 'PAYSTACK_WEBHOOK_SECRET'
        : 'PAYSTACK_SECRET_KEY (fallback)';
      const maskedSecret = this.webhookSecret
        ? `${this.webhookSecret.substring(0, 7)}...${this.webhookSecret.slice(-4)}`
        : '(empty)';
      this.logger.warn(
        `Signature mismatch — secret source: ${secretSource}, key: ${maskedSecret}, ` +
        `computed: ${hash.substring(0, 16)}..., received: ${signature.substring(0, 16)}...`,
      );
    }

    return isValid;
  }

  /**
   * Create a transaction record
   */
  async createTransactionRecord(params: {
    userId: string | Types.ObjectId;
    reference: string;
    amount: number;
    authorizationUrl?: string;
    accessCode?: string;
    metadata?: Record<string, any>;
  }): Promise<PaystackTransactionDocument> {
    const txn = new this.paystackTxnModel({
      userId: new Types.ObjectId(params.userId),
      reference: params.reference,
      amount: params.amount,
      status: PaystackTransactionStatus.PENDING,
      authorizationUrl: params.authorizationUrl,
      accessCode: params.accessCode,
      metadata: params.metadata,
    });

    return txn.save();
  }

  /**
   * Update transaction from webhook
   */
  async updateTransactionFromWebhook(
    reference: string,
    webhookData: Record<string, any>,
  ): Promise<PaystackTransactionDocument | null> {
    const data = webhookData.data || {};
    const status =
      data.status === 'success'
        ? PaystackTransactionStatus.SUCCESS
        : data.status === 'abandoned'
        ? PaystackTransactionStatus.ABANDONED
        : PaystackTransactionStatus.FAILED;

    const updated = await this.paystackTxnModel.findOneAndUpdate(
      { reference },
      {
        status,
        channel: data.channel,
        gatewayResponse: data.gateway_response,
        paidAt: data.paid_at ? new Date(data.paid_at) : undefined,
        rawWebhookEvent: webhookData,
      },
      { new: true },
    );

    if (updated) {
      this.logger.log(`Paystack transaction updated: ${reference} -> ${status}`);
    }

    return updated;
  }

  /**
   * Get transaction by reference
   */
  async getTransactionByReference(
    reference: string,
  ): Promise<PaystackTransactionDocument | null> {
    return this.paystackTxnModel.findOne({ reference }).exec();
  }

  /**
   * Check if transaction is already processed
   */
  async isTransactionProcessed(reference: string): Promise<boolean> {
    const txn = await this.getTransactionByReference(reference);
    return txn?.status === PaystackTransactionStatus.SUCCESS;
  }

  // ============================================
  // DEDICATED VIRTUAL ACCOUNTS (DVA)
  // ============================================

  /**
   * Create a Paystack customer (required before DVA creation)
   */
  async createCustomer(params: {
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }): Promise<{ customerCode: string; id: number }> {
    try {
      const response = await this.apiClient.post('/customer', {
        email: params.email,
        first_name: params.firstName,
        last_name: params.lastName,
        ...(params.phone && { phone: params.phone }),
      });

      const data = response.data.data;
      this.logger.log(`Paystack customer created: ${data.customer_code}`);

      return {
        customerCode: data.customer_code,
        id: data.id,
      };
    } catch (error) {
      // If customer already exists, fetch by email
      if (error.response?.status === 409 || error.response?.data?.message?.includes('already exists')) {
        this.logger.log(`Paystack customer already exists for ${params.email}, fetching...`);
        return this.getCustomerByEmail(params.email);
      }
      this.logger.error('Failed to create Paystack customer', error.response?.data);
      throw new InternalServerErrorException('Failed to create payment customer');
    }
  }

  /**
   * Fetch a Paystack customer by email
   */
  async getCustomerByEmail(email: string): Promise<{ customerCode: string; id: number }> {
    try {
      const response = await this.apiClient.get(`/customer/${encodeURIComponent(email)}`);
      const data = response.data.data;

      return {
        customerCode: data.customer_code,
        id: data.id,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch Paystack customer: ${email}`, error.response?.data);
      throw new InternalServerErrorException('Failed to fetch payment customer');
    }
  }

  /**
   * Create a Dedicated Virtual Account for a customer
   */
  async createDedicatedAccount(params: {
    customerCode: string;
    preferredBank?: string;
  }): Promise<{
    accountName: string;
    accountNumber: string;
    bankName: string;
    bankCode: string;
    bankSlug: string;
    dvaId: number;
    rawResponse: Record<string, any>;
  }> {
    try {
      const response = await this.apiClient.post('/dedicated_account', {
        customer: params.customerCode,
        preferred_bank: params.preferredBank || 'wema-bank',
      });

      const data = response.data.data;
      const bank = data.bank || {};

      this.logger.log(
        `DVA created: ${data.account_number} (${bank.name}) for customer ${params.customerCode}`,
      );

      return {
        accountName: data.account_name,
        accountNumber: data.account_number,
        bankName: bank.name || 'Wema Bank',
        bankCode: bank.id ? String(bank.id) : '',
        bankSlug: bank.slug || 'wema-bank',
        dvaId: data.id,
        rawResponse: data,
      };
    } catch (error) {
      this.logger.error('Failed to create DVA', error.response?.data);
      throw new InternalServerErrorException('Failed to create virtual account');
    }
  }

  /**
   * List dedicated accounts for a customer
   */
  async listDedicatedAccounts(customerCode: string): Promise<any[]> {
    try {
      const response = await this.apiClient.get('/dedicated_account', {
        params: { customer: customerCode },
      });
      return response.data.data || [];
    } catch (error) {
      this.logger.error(`Failed to list DVAs for ${customerCode}`, error.response?.data);
      return [];
    }
  }
}
