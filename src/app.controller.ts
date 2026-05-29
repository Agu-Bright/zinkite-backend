// src/app.controller.ts (backend)
import { Controller, Get, Post, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsString, MaxLength } from "class-validator";
import { EmailService } from "./email/email.service";
import { ConfigService } from "@nestjs/config";

class ContactFormDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  fullName: string;

  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  message: string;
}

@Controller()
@ApiTags("Health")
export class AppController {
  constructor(
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  @Get("health")
  @ApiOperation({ summary: "Health check endpoint" })
  healthCheck() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      message: "Zinkite API is running",
    };
  }

  @Post("support/contact")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Public contact form submission" })
  async contactForm(@Body() dto: ContactFormDto) {
    const supportEmail =
      this.configService.get<string>("SMTP_USER") || "support@zinkite.com";

    await this.emailService.send({
      to: supportEmail,
      subject: `Contact Form: ${dto.fullName}`,
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${dto.fullName}</p>
        <p><strong>Email:</strong> ${dto.email}</p>
        <p><strong>Message:</strong></p>
        <p>${dto.message.replace(/\n/g, "<br>")}</p>
        <hr>
        <p><small>Submitted at ${new Date().toISOString()}</small></p>
      `,
    });

    return { success: true, message: "Message received. We'll get back to you soon!" };
  }
}
