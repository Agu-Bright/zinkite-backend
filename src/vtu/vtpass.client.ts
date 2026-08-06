import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class VtpassClient {
  private readonly logger = new Logger(VtpassClient.name);
  private readonly http: AxiosInstance;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('VTPASS_API_KEY', '');
    const publicKey = config.get<string>('VTPASS_PUBLIC_KEY', '');
    const secretKey = config.get<string>('VTPASS_SECRET_KEY', '');
    this.http = axios.create({
      baseURL: config.get<string>('VTPASS_BASE_URL', 'https://sandbox.vtpass.com/api'),
      timeout: Number(config.get<string>('VTPASS_TIMEOUT_MS', '30000')),
    });
    this.http.interceptors.request.use((request) => {
      if (!apiKey || !publicKey || !secretKey) throw new ServiceUnavailableException('VTpass is not configured');
      request.headers.set('api-key', apiKey);
      request.headers.set(request.method?.toLowerCase() === 'get' ? 'public-key' : 'secret-key', request.method?.toLowerCase() === 'get' ? publicKey : secretKey);
      return request;
    });
  }

  async variations(serviceId: string): Promise<any[]> {
    const { data } = await this.http.get('/service-variations', { params: { serviceID: serviceId } });
    return data?.content?.variations || data?.content?.varations || [];
  }

  async services(identifier: string): Promise<any[]> {
    const { data } = await this.http.get('/services', { params: { identifier } });
    return data?.content || data || [];
  }

  async verify(serviceId: string, billersCode: string, type?: string): Promise<any> {
    const { data } = await this.http.post('/merchant-verify', { serviceID: serviceId, billersCode, ...(type ? { type } : {}) });
    if (data?.code && !['000', '00'].includes(String(data.code))) throw new BadGatewayException(data.response_description || 'Customer verification failed');
    return data;
  }

  async pay(payload: Record<string, any>): Promise<any> {
    const { data } = await this.http.post('/pay', payload);
    return data;
  }

  async requery(requestId: string): Promise<any> {
    const { data } = await this.http.post('/requery', { request_id: requestId });
    return data;
  }

  isDefinitiveFailure(error: any): boolean {
    const code = String(error?.response?.data?.code || '');
    this.logger.warn(`VTpass request failed: ${code || error.message}`);
    return ['010', '011', '012', '013', '016', '017', '018', '091'].includes(code);
  }
}
