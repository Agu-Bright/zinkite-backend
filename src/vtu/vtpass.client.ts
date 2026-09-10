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

    // TEMP DIAGNOSTIC — prints password length + first/last char so we can
    // confirm whether the container is receiving the FULL 15-char string
    // ("ZzvJad_YmPC$rW3") or a truncated one ("ZzvJad_YmPC") because a
    // parser ate the `$rW3` as shell variable expansion. Remove after
    // troubleshooting.
    this.logger.warn(
      `VTpass password diagnostic | len=${password.length} | first=${password.slice(0, 1)} | last=${password.slice(-1)} | contains$=${password.includes('$')}`,
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

    // Dump the ENTIRE VTpass error response, one field per log line so
    // NestJS's Logger emits each as its own [Nest] ERROR entry — that way
    // Coolify / any log aggregator can't strip it as "raw stdout noise".
    this.http.interceptors.response.use(
      (response) => response,
      (error) => {
        const req = error?.config || {};
        const res = error?.response || {};

        // Redact auth headers so screenshots stay safe to share.
        const sanitizedReqHeaders = { ...(req.headers || {}) };
        for (const k of Object.keys(sanitizedReqHeaders)) {
          if (/^authorization$/i.test(k)) sanitizedReqHeaders[k] = '[REDACTED]';
          if (/^secret-key$/i.test(k)) sanitizedReqHeaders[k] = '[REDACTED]';
          if (/^api-key$/i.test(k)) sanitizedReqHeaders[k] = '[REDACTED]';
        }

        const method = String(req.method || '').toUpperCase();
        const fullUrl = `${req.baseURL || ''}${req.url || ''}`;
        const status = res.status ? `${res.status} ${res.statusText || ''}` : 'NO_RESPONSE';
        const reqBody = typeof req.data === 'string' ? req.data : JSON.stringify(req.data);
        const resBody = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);

        this.logger.error('===== VTPASS ERROR (start) =====');
        this.logger.error(`>>> REQUEST: ${method} ${fullUrl}`);
        this.logger.error(`>>> REQ HEADERS: ${JSON.stringify(sanitizedReqHeaders)}`);
        this.logger.error(`>>> REQ BODY: ${reqBody}`);
        this.logger.error(`<<< HTTP STATUS: ${status}`);
        this.logger.error(`<<< RES HEADERS: ${JSON.stringify(res.headers || {})}`);
        this.logger.error(`<<< RES BODY: ${resBody}`);
        this.logger.error(`AXIOS MSG: ${error?.message || ''} | AXIOS CODE: ${error?.code || ''}`);
        this.logger.error('===== VTPASS ERROR (end) =====');

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
    const code = String(data?.code || 'NO_CODE');
    const status = String(data?.content?.transactions?.status || 'NO_STATUS');
    const description = String(data?.response_description || data?.message || 'No description');
    this.logger.log(
      `VTpass pay result | service=${payload.serviceID} | requestId=${payload.request_id} | code=${code} | status=${status} | description=${description}`,
    );
    if (data?.content?.errors) {
      this.logger.warn(
        `VTpass validation details | service=${payload.serviceID} | requestId=${payload.request_id} | errors=${JSON.stringify(data.content.errors)}`,
      );
    }
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
