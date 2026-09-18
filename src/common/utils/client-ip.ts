import { isIP } from 'net';

export function normalizeIpAddress(value: unknown): string {
  let ip = String(value || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return isIP(ip) ? ip.toLowerCase() : '';
}

export function getClientIp(req: Record<string, any>): string {
  return normalizeIpAddress(req.ip || req.socket?.remoteAddress);
}
