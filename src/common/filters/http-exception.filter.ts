/**
 * HTTP Exception Filter
 * 
 * Catches all HTTP exceptions and formats them consistently.
 * Provides structured error responses with timestamp, path, and details.
 */
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  error: string;
  details?: any;
  timestamp: string;
  path: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';
    let details: any = undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const res = exceptionResponse as any;
        message = res.message || exception.message;
        error = res.error || this.getErrorName(statusCode);
        details = res.details;

        // Handle validation errors (class-validator)
        if (Array.isArray(message)) {
          details = message;
          message = 'Validation failed';
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      
      // Log unexpected errors
      this.logger.error(
        `Unexpected error: ${exception.message}`,
        exception.stack,
      );
    }

    if (statusCode === HttpStatus.TOO_MANY_REQUESTS) {
      message = 'Too many requests. Please wait a moment and try again.';
      error = 'Too Many Requests';
    }

    const errorResponse: ErrorResponse = {
      success: false,
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (details) {
      errorResponse.details = details;
    }

    // Log error for debugging.
    //
    // For validation failures we dump the *entire* class-validator details
    // array — every field message, joined line-by-line so Coolify's log
    // aggregator can't strip any of it — plus the raw request body (with
    // secrets scrubbed) so we can see exactly what the client sent. Without
    // this, "Validation failed" alone is useless for diagnosis.
    const isValidationFailure =
      statusCode === HttpStatus.BAD_REQUEST && Array.isArray(details) && details.length > 0;

    if (isValidationFailure) {
      this.logger.warn(
        `${request.method} ${request.url} - ${statusCode}: ${message}`,
      );
      this.logger.warn(`===== VALIDATION ERRORS (${details.length}) =====`);
      details.forEach((msg: any, i: number) => {
        this.logger.warn(`  [${i + 1}] ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
      });
      // Scrub obvious secrets before logging the body — never log PIN,
      // password, token, or OTP values verbatim.
      const scrubbed = this.scrubBody(request.body);
      this.logger.warn(`===== REQUEST BODY =====`);
      this.logger.warn(JSON.stringify(scrubbed));
      this.logger.warn(`===== END VALIDATION =====`);
    } else {
      this.logger.warn(
        `${request.method} ${request.url} - ${statusCode}: ${message}`,
      );
    }

    response.status(statusCode).json(errorResponse);
  }

  /**
   * Strip secrets from a request body before logging it. We only look one
   * level deep — that's every case the API cares about — and replace values
   * for known-sensitive keys with a fixed placeholder.
   */
  private scrubBody(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body;
    const SECRET_KEYS = new Set([
      'pin',
      'transactionPin',
      'password',
      'newPassword',
      'currentPassword',
      'oldPassword',
      'confirmPassword',
      'otp',
      'token',
      'refreshToken',
      'accessToken',
    ]);
    const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    for (const key of Object.keys(clone)) {
      if (SECRET_KEYS.has(key)) {
        clone[key] = '[REDACTED]';
      }
    }
    return clone;
  }

  /**
   * Get error name from status code
   */
  private getErrorName(statusCode: number): string {
    const errorNames: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    };
    return errorNames[statusCode] || 'Error';
  }
}
