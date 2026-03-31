/**
 * Reloadly Service
 *
 * HTTP client for the Reloadly Gift Cards API.
 * Handles OAuth token management and all API interactions.
 *
 * Base URLs:
 *   Sandbox:    https://giftcards-sandbox.reloadly.com
 *   Production: https://giftcards.reloadly.com
 *   Auth:       https://auth.reloadly.com/oauth/token
 */
import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ReloadlyProductResponse {
  productId: number;
  productName: string;
  global: boolean;
  senderFee: number;
  discountPercentage: number;
  denominationType: 'FIXED' | 'RANGE';
  recipientCurrencyCode: string;
  senderCurrencyCode: string;
  minRecipientDenomination: number | null;
  maxRecipientDenomination: number | null;
  fixedRecipientDenominations: number[];
  fixedSenderDenominations: number[];
  fixedRecipientToSenderDenominationsMap: Record<string, number>;
  logoUrls: string[];
  brand: { brandId: number; brandName: string };
  country: { isoName: string; name: string; flagUrl: string };
  redeemInstruction: { concise: string; verbose: string } | null;
}

export interface ReloadlyOrderResponse {
  transactionId: number;
  amount: number;
  discount: number;
  currencyCode: string;
  fee: number;
  smsFee: number;
  recipientEmail: string;
  recipientPhone: string;
  customIdentifier: string;
  status: string;
  transactionCreatedTime: string;
  product: {
    productId: number;
    productName: string;
    countryCode: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    currencyCode: string;
    brand: { brandId: number; brandName: string };
  };
}

export interface ReloadlyRedeemCode {
  cardNumber: string;
  pinCode: string;
}

@Injectable()
export class ReloadlyService {
  private readonly logger = new Logger(ReloadlyService.name);

  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  private readonly baseUrl: string;
  private readonly authUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('RELOADLY_BASE_URL') || 'https://giftcards-sandbox.reloadly.com';
    this.authUrl = this.configService.get<string>('RELOADLY_AUTH_URL') || 'https://auth.reloadly.com/oauth/token';
    this.clientId = this.configService.get<string>('RELOADLY_CLIENT_ID') || '';
    this.clientSecret = this.configService.get<string>('RELOADLY_CLIENT_SECRET') || '';
  }

  /**
   * Get or refresh OAuth access token
   */
  async getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60000) {
      return this.accessToken;
    }

    try {
      this.logger.log('Refreshing Reloadly access token...');

      const response = await fetch(this.authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials',
          audience: this.baseUrl,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Auth failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

      this.logger.log('Reloadly access token refreshed successfully');
      return this.accessToken!;
    } catch (error: any) {
      this.logger.error(`Failed to get Reloadly token: ${error.message}`);
      throw new InternalServerErrorException('Failed to authenticate with Reloadly');
    }
  }

  /**
   * Make authenticated request to Reloadly API
   */
  private async request<T>(
    method: string,
    path: string,
    body?: any,
    retries = 1,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}${path}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/com.reloadly.giftcards-v1+json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.status === 401 && retries > 0) {
        // Token expired, refresh and retry
        this.accessToken = null;
        return this.request<T>(method, path, body, retries - 1);
      }

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Reloadly API error: ${method} ${path} -> ${response.status}: ${errorText}`);
        throw new Error(`Reloadly API ${response.status}: ${errorText}`);
      }

      return response.json() as Promise<T>;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new InternalServerErrorException('Reloadly API request timed out');
      }
      throw error;
    }
  }

  // ─── Products ─────────────────────────────────────────────

  /**
   * List products (paginated)
   */
  async getProducts(page = 1, size = 200): Promise<ReloadlyProductResponse[]> {
    // Reloadly uses 0-indexed pages
    return this.request<ReloadlyProductResponse[]>(
      'GET',
      `/products?size=${size}&page=${page - 1}`,
    );
  }

  /**
   * Get products by country code
   */
  async getProductsByCountry(countryCode: string): Promise<ReloadlyProductResponse[]> {
    return this.request<ReloadlyProductResponse[]>(
      'GET',
      `/countries/${countryCode.toUpperCase()}/products`,
    );
  }

  /**
   * Get a single product by ID
   */
  async getProductById(productId: number): Promise<ReloadlyProductResponse> {
    return this.request<ReloadlyProductResponse>('GET', `/products/${productId}`);
  }

  // ─── Orders ───────────────────────────────────────────────

  /**
   * Order a gift card
   */
  async orderGiftCard(params: {
    productId: number;
    countryCode: string;
    quantity: number;
    unitPrice: number;
    customIdentifier: string;
    senderName?: string;
    recipientEmail?: string;
  }): Promise<ReloadlyOrderResponse> {
    return this.request<ReloadlyOrderResponse>('POST', '/orders', {
      productId: params.productId,
      countryCode: params.countryCode,
      quantity: params.quantity,
      unitPrice: params.unitPrice,
      customIdentifier: params.customIdentifier,
      senderName: params.senderName || 'Zinkite',
      recipientEmail: params.recipientEmail || 'orders@zinkite.com',
    });
  }

  // ─── Redeem Codes ─────────────────────────────────────────

  /**
   * Get redeem codes for a completed order
   */
  async getRedeemCodes(transactionId: number): Promise<ReloadlyRedeemCode[]> {
    return this.request<ReloadlyRedeemCode[]>(
      'GET',
      `/orders/transactions/${transactionId}/cards`,
    );
  }

  // ─── Redeem Instructions ──────────────────────────────────

  /**
   * Get redeem instructions for a brand
   */
  async getRedeemInstructions(
    brandId: number,
  ): Promise<{ concise: string; verbose: string }> {
    return this.request<{ concise: string; verbose: string }>(
      'GET',
      `/redeem-instructions/${brandId}`,
    );
  }

  // ─── Health ───────────────────────────────────────────────

  /**
   * Health check — try fetching 1 product
   */
  async healthCheck(): Promise<{ ok: boolean; responseTimeMs: number }> {
    const start = Date.now();
    try {
      await this.getProducts(1, 1);
      return { ok: true, responseTimeMs: Date.now() - start };
    } catch {
      return { ok: false, responseTimeMs: Date.now() - start };
    }
  }
}
