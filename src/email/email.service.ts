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
   * Send trade approved email
   */
  async sendTradeApproved(
    email: string,
    brandName: string,
    cardValueUsd: number,
    amountNgn: number,
    reference: string,
  ): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #059669; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .amount { font-size: 32px; font-weight: bold; color: #059669; text-align: center; margin: 20px 0; }
          .details { background: white; padding: 20px; border-radius: 8px; }
          .details p { margin: 8px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Trade Approved!</h1>
          </div>
          <div class="content">
            <p>Great news! Your gift card trade has been approved.</p>
            <div class="amount">+\u20A6${amountNgn.toLocaleString()}</div>
            <div class="details">
              <p><strong>Brand:</strong> ${brandName}</p>
              <p><strong>Card Value:</strong> $${cardValueUsd}</p>
              <p><strong>Credited:</strong> \u20A6${amountNgn.toLocaleString()}</p>
              <p><strong>Reference:</strong> ${reference}</p>
            </div>
            <p style="margin-top: 20px;">The amount has been credited to your wallet.</p>
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
      subject: `Trade Approved: \u20A6${amountNgn.toLocaleString()} credited`,
      html,
      text: `Your ${brandName} gift card trade has been approved. \u20A6${amountNgn.toLocaleString()} has been credited to your wallet. Reference: ${reference}`,
    });
  }

  /**
   * Send trade rejected email
   */
  async sendTradeRejected(
    email: string,
    brandName: string,
    reference: string,
    reason: string,
  ): Promise<boolean> {
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
          .reason { background: #FEF2F2; border: 1px solid #FECACA; padding: 15px; border-radius: 8px; margin: 20px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Trade Rejected</h1>
          </div>
          <div class="content">
            <p>Unfortunately, your gift card trade has been rejected.</p>
            <p><strong>Brand:</strong> ${brandName}</p>
            <p><strong>Reference:</strong> ${reference}</p>
            <div class="reason">
              <strong>Reason:</strong> ${reason}
            </div>
            <p>If you believe this is an error, please contact our support team.</p>
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
      subject: `Trade Rejected: ${brandName} - ${reference}`,
      html,
      text: `Your ${brandName} gift card trade (${reference}) has been rejected. Reason: ${reason}. Contact support if you believe this is an error.`,
    });
  }

  /**
   * Send withdrawal completed email
   */
  async sendWithdrawalCompleted(
    email: string,
    amountNgn: number,
    bankName: string,
    accountNumber: string,
    reference: string,
  ): Promise<boolean> {
    const masked = accountNumber.slice(-4).padStart(accountNumber.length, '*');
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #059669; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
          .amount { font-size: 32px; font-weight: bold; color: #059669; text-align: center; margin: 20px 0; }
          .details { background: white; padding: 20px; border-radius: 8px; }
          .details p { margin: 8px 0; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Withdrawal Successful</h1>
          </div>
          <div class="content">
            <p>Your withdrawal has been processed successfully.</p>
            <div class="amount">\u20A6${amountNgn.toLocaleString()}</div>
            <div class="details">
              <p><strong>Bank:</strong> ${bankName}</p>
              <p><strong>Account:</strong> ${masked}</p>
              <p><strong>Reference:</strong> ${reference}</p>
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
      subject: `Withdrawal Completed: \u20A6${amountNgn.toLocaleString()}`,
      html,
    });
  }

  /**
   * Send admin a "new withdrawal needs payout" alert.
   * The admin reads this, sends the money out-of-band, then marks the
   * withdrawal as SUCCESS in the admin dashboard.
   */
  async sendAdminWithdrawalAlert(
    adminEmail: string,
    params: {
      reference: string;
      amountNaira: number;
      bankName: string;
      accountNumber: string;
      accountName: string;
      userEmail: string;
      userFullName: string;
      userPhone: string;
      createdAt: Date;
    },
  ): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background: #f4f6fb; }
          .container { max-width: 620px; margin: 0 auto; padding: 24px; }
          .card { background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,0.06); }
          .header { background: linear-gradient(135deg, #0055DD, #0080FF); color: white; padding: 24px; }
          .header h1 { margin: 0; font-size: 22px; }
          .header .sub { margin: 4px 0 0; opacity: 0.85; font-size: 13px; }
          .amount-row { background: #f8faff; padding: 22px; text-align: center; }
          .amount { font-size: 36px; font-weight: 700; color: #0055DD; margin: 4px 0; }
          .amount-label { color: #6B7280; font-size: 12px; letter-spacing: 1.5px; }
          .block { padding: 22px; border-top: 1px solid #eee; }
          .block h3 { margin: 0 0 12px; color: #0055DD; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; }
          .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
          .row .label { color: #6B7280; }
          .row .val { color: #0a0a0a; font-weight: 600; text-align: right; }
          .cta { text-align: center; padding: 22px; }
          .cta p { color: #6B7280; font-size: 12px; margin-top: 12px; }
          .footer { text-align: center; color: #999; font-size: 11px; margin-top: 16px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <h1>\uD83D\uDCB0 New withdrawal needs payout</h1>
              <p class="sub">A user has initiated a withdrawal \u2014 review and send the money.</p>
            </div>
            <div class="amount-row">
              <div class="amount-label">AMOUNT</div>
              <div class="amount">\u20A6${params.amountNaira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div style="color:#6B7280;font-size:12px;">Ref: ${params.reference}</div>
            </div>
            <div class="block">
              <h3>Send to</h3>
              <div class="row"><span class="label">Account name</span><span class="val">${params.accountName}</span></div>
              <div class="row"><span class="label">Account number</span><span class="val">${params.accountNumber}</span></div>
              <div class="row"><span class="label">Bank</span><span class="val">${params.bankName}</span></div>
            </div>
            <div class="block">
              <h3>Customer</h3>
              <div class="row"><span class="label">Name</span><span class="val">${params.userFullName}</span></div>
              <div class="row"><span class="label">Email</span><span class="val">${params.userEmail}</span></div>
              <div class="row"><span class="label">Phone</span><span class="val">${params.userPhone}</span></div>
              <div class="row"><span class="label">Requested</span><span class="val">${new Date(params.createdAt).toLocaleString('en-NG')}</span></div>
            </div>
            <div class="cta">
              <p>Process this transfer from your business bank, then mark the withdrawal as SUCCESS in the admin dashboard.</p>
            </div>
          </div>
          <div class="footer">
            <p>Zinkitex admin alert. Do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.send({
      to: adminEmail,
      subject: `\uD83D\uDD14 Payout needed: \u20A6${params.amountNaira.toLocaleString('en-NG')} \u2014 ${params.accountName}`,
      html,
      text: `New withdrawal of \u20A6${params.amountNaira.toLocaleString('en-NG')} from ${params.userFullName} (${params.userEmail}). Send to ${params.accountName} / ${params.accountNumber} / ${params.bankName}. Ref ${params.reference}.`,
    });
  }

  /**
   * Send withdrawal failed email
   */
  async sendWithdrawalFailed(
    email: string,
    amountNgn: number,
    reference: string,
    reason: string,
  ): Promise<boolean> {
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
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Withdrawal Failed</h1>
          </div>
          <div class="content">
            <p>Your withdrawal of <strong>\u20A6${amountNgn.toLocaleString()}</strong> could not be processed.</p>
            <p><strong>Reference:</strong> ${reference}</p>
            <p><strong>Reason:</strong> ${reason}</p>
            <p>The amount has been refunded to your wallet. Please try again or contact support.</p>
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
      subject: `Withdrawal Failed: \u20A6${amountNgn.toLocaleString()}`,
      html,
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
