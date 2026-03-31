/**
 * Utility Functions
 * 
 * Common helper functions used across the application.
 */
import { v4 as uuidv4 } from 'uuid';
import { PaginationMeta, PaginatedResult } from '../dto/pagination.dto';

/**
 * Generate unique reference with optional prefix
 * Format: PREFIX_TIMESTAMP_UUID
 */
export function generateReference(prefix: string = 'TXN'): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const uuid = uuidv4().split('-')[0].toUpperCase();
  return `${prefix}_${timestamp}_${uuid}`;
}

/**
 * Generate OTP of specified length
 */
export function generateOtp(length: number = 6): string {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
}

/**
 * Create paginated result
 */
export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): PaginatedResult<T> {
  const totalPages = Math.ceil(total / limit);
  
  const meta: PaginationMeta = {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };

  return { data, meta };
}

/**
 * Calculate skip value for MongoDB pagination
 */
export function calculateSkip(page: number, limit: number): number {
  return (page - 1) * limit;
}

/**
 * Mask sensitive data for logging
 */
export function maskSensitive(data: string, visibleChars: number = 4): string {
  if (!data || data.length <= visibleChars) {
    return '****';
  }
  return '*'.repeat(data.length - visibleChars) + data.slice(-visibleChars);
}

/**
 * Format currency amount (kobo to naira, etc.)
 */
export function formatAmount(
  amount: number,
  divisor: number = 100,
): string {
  return (amount / divisor).toFixed(2);
}

/**
 * Convert naira to kobo
 */
export function toKobo(naira: number): number {
  return Math.round(naira * 100);
}

/**
 * Convert kobo to naira
 */
export function toNaira(kobo: number): number {
  return kobo / 100;
}

/**
 * Sanitize object for logging (remove sensitive fields)
 */
export function sanitizeForLog(obj: any): any {
  const sensitiveKeys = [
    'password',
    'pin',
    'secret',
    'token',
    'apiKey',
    'authorization',
  ];
  
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const sanitized = { ...obj };
  
  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeForLog(sanitized[key]);
    }
  }
  
  return sanitized;
}
