/**
 * Zinkite Backend - Main Entry Point
 * 
 * Configures the NestJS application with:
 * - CORS
 * - Validation pipes
 * - Swagger documentation at /docs
 * - Global exception filters
 */
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Enable CORS for known clients
  const allowedOrigins = [
    'https://zinkite.com',
    'https://www.zinkite.com',
    'https://admin.zinkite.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
  ];
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (mobile apps, Postman, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  });

  // Global validation pipe with transformation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter for consistent error responses
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global response transformation interceptor
  app.useGlobalInterceptors(new TransformInterceptor());

  // Swagger API Documentation Configuration
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Zinkite Backend API')
    .setDescription(
      `
## Zinkite Gift Card Trading API

### Authentication Flows:
- **Email Registration**: Register → Verify OTP → Set PIN → Login
- **Google Sign-In**: POST /auth/google with idToken
- **Apple Sign-In**: POST /auth/apple with identityToken

### Security:
- All protected routes require **Bearer JWT** token
- Sensitive actions require **x-txn-pin** header (4-digit PIN)

### Workflows:
1. **Wallet Top-up**: Initialize Paystack → Pay → Webhook credits wallet
2. **Gift Card Trades**: Submit trade → Admin approval → Wallet credited
      `,
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter JWT access token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-txn-pin',
        in: 'header',
        description: '4-digit transaction PIN for sensitive operations',
      },
      'PIN-auth',
    )
    .addTag('Auth', 'Authentication endpoints (email + social)')
    .addTag('Wallet', 'Wallet management and transactions')
    .addTag('Gift Cards', 'Gift card brands, rates, and trades')
    .addTag('Uploads', 'File uploads (gift card proofs)')
    .addTag('Webhooks', 'External service webhooks')
    .addTag('Admin', 'Admin-only operations')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: 'Zinkite API Docs',
  });

  // Enable graceful shutdown hooks
  app.enableShutdownHooks();

  const port = process.env.PORT || 3001;
  await app.listen(port);

  logger.log(`Application running on: http://localhost:${port}`);
  logger.log(`Swagger docs available at: http://localhost:${port}/docs`);
}

bootstrap();
