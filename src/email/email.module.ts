/**
 * Email Module
 * 
 * Provides email sending functionality via SMTP.
 */
import { Module, Global } from '@nestjs/common';
import { EmailService } from './email.service';

@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
