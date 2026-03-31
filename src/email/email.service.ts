/**
 * Email Service
 * 
 * Sends transactional emails using Nodemailer SMTP.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter;
  private readonly fromAddress: string;

  constructor(private readonly configService: ConfigService) {
    this.fromAddress = this.configService.get<string>(
      'SMTP_FROM',
      'Zinkite <contact@zinkite.com>',
    );

    // Create SMTP transporter
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT', 587),
      secure: this.configService.get<number>('SMTP_PORT', 587) === 465,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });

    // Verify connection on startup
    this.verifyConnection();
  }

  /**
   * Verify SMTP connection
   */
  private async verifyConnection(): Promise<void> {
    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified');
    } catch (error) {
      this.logger.warn(`SMTP connection failed: ${error.message}`);
    }
  }

  /**
   * Send an email
   */
  async send(options: SendEmailOptions): Promise<boolean> {
    try {
      const info = await this.transporter.sendMail({
        from: this.fromAddress,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      this.logger.log(`Email sent to ${options.to}: ${info.messageId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${options.to}: ${error.message}`);
      return false;
    }
  }

  /**
   * Send OTP verification email
   */
  async sendVerificationOtp(email: string, otp: string): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0B1240; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .otp-code { font-size: 32px; font-weight: bold; color: #14C96C; text-align: center;
                      letter-spacing: 8px; padding: 20px; background: white; border-radius: 8px; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Email Verification</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Thank you for registering. Please use the following OTP to verify your email address:</p>
            <div class="otp-code">${otp}</div>
            <p>This code will expire in <strong>10 minutes</strong>.</p>
            <p>If you didn't request this verification, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Zinkite. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.send({
      to: email,
      subject: `Your verification code: ${otp}`,
      html,
      text: `Your verification code is: ${otp}. This code expires in 10 minutes.`,
    });
  }

  /**
   * Send PIN reset OTP email
   */
  async sendPinResetOtp(email: string, otp: string): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #DC2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .otp-code { font-size: 32px; font-weight: bold; color: #DC2626; text-align: center; 
                      letter-spacing: 8px; padding: 20px; background: white; border-radius: 8px; margin: 20px 0; }
          .warning { background: #FEF2F2; border: 1px solid #FECACA; padding: 15px; border-radius: 8px; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>PIN Reset Request</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>We received a request to reset your transaction PIN. Use this OTP to proceed:</p>
            <div class="otp-code">${otp}</div>
            <p>This code will expire in <strong>10 minutes</strong>.</p>
            <div class="warning">
              <strong>⚠️ Security Notice:</strong> If you didn't request this reset, 
              please secure your account immediately.
            </div>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Zinkite. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.send({
      to: email,
      subject: `PIN Reset Code: ${otp}`,
      html,
      text: `Your PIN reset code is: ${otp}. This code expires in 10 minutes. If you didn't request this, please secure your account.`,
    });
  }

  /**
   * Send password reset OTP email
   */
  async sendPasswordResetOtp(email: string, otp: string): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563EB; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .otp-code { font-size: 32px; font-weight: bold; color: #2563EB; text-align: center;
                      letter-spacing: 8px; padding: 20px; background: white; border-radius: 8px; margin: 20px 0; }
          .warning { background: #FEF2F2; border: 1px solid #FECACA; padding: 15px; border-radius: 8px; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset Request</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>We received a request to reset your account password. Use this OTP to proceed:</p>
            <div class="otp-code">${otp}</div>
            <p>This code will expire in <strong>10 minutes</strong>.</p>
            <div class="warning">
              <strong>⚠️ Security Notice:</strong> If you didn't request this reset,
              please secure your account immediately.
            </div>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Zinkite. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.send({
      to: email,
      subject: `Password Reset Code: ${otp}`,
      html,
      text: `Your password reset code is: ${otp}. This code expires in 10 minutes. If you didn't request this, please secure your account.`,
    });
  }

  /**
   * Send account deletion OTP email
   */
  async sendAccountDeletionOtp(email: string, otp: string): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #DC2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .otp-code { font-size: 32px; font-weight: bold; color: #DC2626; text-align: center;
                      letter-spacing: 8px; padding: 20px; background: white; border-radius: 8px; margin: 20px 0; }
          .warning { background: #FEF2F2; border: 1px solid #FECACA; padding: 15px; border-radius: 8px; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Account Deletion Request</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>We received a request to permanently delete your Zinkite account and all associated data. Use the code below to confirm:</p>
            <div class="otp-code">${otp}</div>
            <p>This code will expire in <strong>10 minutes</strong>.</p>
            <div class="warning">
              <strong>⚠️ Warning:</strong> This action is permanent and cannot be undone.
              Your wallet balance, transaction history, and all personal data will be permanently removed.
              If you did not request this, please ignore this email and secure your account.
            </div>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Zinkite. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.send({
      to: email,
      subject: `Account Deletion Confirmation Code: ${otp}`,
      html,
      text: `Your account deletion confirmation code is: ${otp}. This code expires in 10 minutes. WARNING: This action is permanent. If you did not request this, please ignore this email.`,
    });
  }

  /**
   * Send account deletion confirmation email
   */
  async sendAccountDeletionConfirmation(email: string): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0B1240; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Account Deleted</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Your Zinkite account has been successfully deleted. All your personal data, wallet information, and transaction history have been removed from our systems.</p>
            <p>If you believe this was done in error, please contact our support team immediately at <strong>support@zinkite.com</strong>.</p>
            <p>We're sorry to see you go. You're always welcome back.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Zinkite. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.send({
      to: email,
      subject: 'Your Zinkite Account Has Been Deleted',
      html,
      text: 'Your Zinkite account has been successfully deleted. All your personal data has been removed. If this was done in error, contact support@zinkite.com immediately.',
    });
  }

  /**
   * Send transaction notification email
   */
  async sendTransactionNotification(
    email: string,
    type: 'CREDIT' | 'DEBIT',
    amount: number,
    currency: string,
    description: string,
  ): Promise<boolean> {
    const isCredit = type === 'CREDIT';
    const color = isCredit ? '#059669' : '#DC2626';
    const symbol = isCredit ? '+' : '-';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: ${color}; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .amount { font-size: 36px; font-weight: bold; color: ${color}; text-align: center; margin: 20px 0; }
          .details { background: white; padding: 20px; border-radius: 8px; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${isCredit ? 'Credit' : 'Debit'} Alert</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Your wallet has been ${isCredit ? 'credited' : 'debited'}:</p>
            <div class="amount">${symbol}${currency} ${amount.toLocaleString()}</div>
            <div class="details">
              <p><strong>Description:</strong> ${description}</p>
              <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
            </div>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Zinkite. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.send({
      to: email,
      subject: `${isCredit ? 'Credit' : 'Debit'} Alert: ${symbol}${currency} ${amount.toLocaleString()}`,
      html,
    });
  }
}
