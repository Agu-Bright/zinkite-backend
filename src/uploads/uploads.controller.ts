/**
 * Uploads Controller
 * 
 * Handles file upload endpoints.
 */
import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { UploadsService, UploadResult } from './uploads.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Uploads')
@ApiBearerAuth('JWT-auth')
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  /**
   * Upload gift card proof image
   */
  @Post('giftcard-proof')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload gift card proof image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Image file (jpeg, png, gif, webp)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'File uploaded successfully',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', example: 'https://res.cloudinary.com/...' },
        publicId: { type: 'string', example: 'giftcard-proofs/abc123' },
        format: { type: 'string', example: 'jpg' },
        bytes: { type: 'number', example: 123456 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async uploadGiftCardProof(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadResult> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    return this.uploadsService.uploadGiftCardProof(file);
  }

  /**
   * Upload user avatar image
   */
  @Post('avatar')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload user avatar image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Image file (jpeg, png, gif, webp)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Avatar uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadResult> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    return this.uploadsService.uploadAvatar(file);
  }

  /**
   * Upload brand logo
   */
  @Post('brand-logo')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload gift card brand logo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Logo image (jpeg, png, gif, webp, svg)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Logo uploaded successfully',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', example: 'https://res.cloudinary.com/...' },
        publicId: { type: 'string', example: 'brand-logos/abc123' },
        format: { type: 'string', example: 'png' },
        bytes: { type: 'number', example: 45678 },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async uploadBrandLogo(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadResult> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    return this.uploadsService.uploadBrandLogo(file);
  }

  /**
   * Upload promo banner image
   */
  @Post('promo-banner')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload promo banner image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Banner image (jpeg, png, gif, webp)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Banner image uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  async uploadPromoBanner(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadResult> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    return this.uploadsService.uploadPromoBanner(file);
  }

  /**
   * Upload gift card shop product image
   */
  @Post('giftcard-shop-image')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload gift card shop product image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Product image (jpeg, png, gif, webp)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 201, description: 'Product image uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  async uploadShopProductImage(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadResult> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    return this.uploadsService.uploadShopProductImage(file);
  }
}
