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
    // VTpass merchant accounts can be provisioned to require Basic Auth in
    // addition to (or instead of) the api-key/secret-key headers. Cardviro
    // sends both, and we mirror that so a 401 from the airtime endpoint
    // isn't caused by a missing Basic Auth challenge.
    const username = config.get<string>('VTPASS_USERNAME', '');
    const password = config.get<string>('VTPASS_PASSWORD', '');
    const basicAuth =
      username && password
        ? Buffer.from(`${username}:${password}`).toString('base64')
        : '';

    const baseURL = config.get<string>('VTPASS_BASE_URL', 'https://sandbox.vtpass.com/api');

    // Startup log — tells you at a glance which auth mechanisms are wired.
    // Everything is masked so nothing sensitive lands in the logs.
    const mask = (v: string) => (v ? `set(len=${v.length}, ${v.slice(0, 4)}…)` : 'MISSING');
    this.logger.log(
      `VTpass client init | baseURL=${baseURL} | apiKey=${mask(apiKey)} | publicKey=${mask(publicKey)} | secretKey=${mask(secretKey)} | basicAuth=${basicAuth ? `on(user=${username.slice(0, 3)}…)` : 'off'}`,
    );

    this.http = axios.create({
      baseURL,
      timeout: Number(config.get<string>('VTPASS_TIMEOUT_MS', '30000')),
      // Explicit Content-Type mirrors Cardviro; some VTpass tenants reject
      // requests where axios omits it on empty POST bodies.
      headers: { 'Content-Type': 'application/json' },
    });
    this.http.interceptors.request.use((request) => {
      if (!apiKey || !publicKey || !secretKey) throw new ServiceUnavailableException('VTpass is not configured');
      request.headers.set('api-key', apiKey);
      request.headers.set(request.method?.toLowerCase() === 'get' ? 'public-key' : 'secret-key', request.method?.toLowerCase() === 'get' ? publicKey : secretKey);
      if (basicAuth) {
        request.headers.set('Authorization', `Basic ${basicAuth}`);
      }
      return request;
    });

    // Diagnostic response interceptor — turn 401s into actionable log lines
    // instead of the generic "Request failed with status code 401".
    this.http.interceptors.response.use(
      (response) => response,
      (error) => {
        const status = error?.response?.status;
        const url = `${error?.config?.method?.toUpperCase() || ''} ${error?.config?.url || ''}`;
        const body = error?.response?.data;
        if (status === 401) {
          this.logger.error(
            `VTpass 401 UNAUTHORIZED on ${url}. ` +
              `baseURL=${baseURL} basicAuth=${basicAuth ? 'on' : 'off'} ` +
              `— Check: (1) API key + secret key belong to the SAME environment as baseURL (sandbox vs live). ` +
              `(2) If your account requires Basic Auth, set VTPASS_USERNAME + VTPASS_PASSWORD. ` +
              `(3) If your account is IP-whitelisted on VTpass, confirm your server's outbound IP is on the list. ` +
              `Response body: ${JSON.stringify(body)}`,
          );
        } else if (status) {
          this.logger.warn(
            `VTpass ${status} on ${url}. Response: ${JSON.stringify(body)}`,
          );
        }
        throw error;
      },
    );
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
