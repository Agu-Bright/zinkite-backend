/**
 * Uploads Service
 *
 * Handles all file uploads via Cloudinary.
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import * as streamifier from 'streamifier';

export interface UploadResult {
  url: string;
  publicId: string;
  format: string;
  bytes: number;
}

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg', // some clients send this non-standard variant
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/heic', // iOS native format
  'image/heif',
];

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get<string>('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get<string>('CLOUDINARY_API_SECRET'),
    });
  }

  /**
   * Upload an image to Cloudinary.
   *
   * @param file   - Multer file
   * @param folder - Cloudinary folder (e.g. 'giftcard-proofs', 'promo-banners')
   * @param maxSizeMb - Max file size in MB (default 10)
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string = 'uploads',
    maxSizeMb: number = 10,
  ): Promise<UploadResult> {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file provided');
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`,
      );
    }

    const maxSize = maxSizeMb * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(`File size exceeds ${maxSizeMb}MB limit`);
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'image',
          transformation: [
            { quality: 'auto:good' },
            { fetch_format: 'auto' },
          ],
        },
        (error: UploadApiErrorResponse | undefined, result: UploadApiResponse | undefined) => {
          if (error) {
            this.logger.error('Cloudinary upload error', error);
            reject(new InternalServerErrorException('Failed to upload file'));
            return;
          }

          if (!result) {
            reject(new InternalServerErrorException('Upload returned no result'));
            return;
          }

          this.logger.log(`File uploaded: ${result.public_id}`);

          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            bytes: result.bytes,
          });
        },
      );

      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
  }

  /**
   * Upload a gift card proof image.
   */
  async uploadGiftCardProof(file: Express.Multer.File): Promise<UploadResult> {
    return this.uploadFile(file, 'giftcard-proofs', 10);
  }

  /**
   * Upload a user avatar.
   */
  async uploadAvatar(file: Express.Multer.File): Promise<UploadResult> {
    return this.uploadFile(file, 'avatars', 5);
  }

  /**
   * Upload a gift card brand logo.
   */
  async uploadBrandLogo(file: Express.Multer.File): Promise<UploadResult> {
    return this.uploadFile(file, 'brand-logos', 5);
  }

  /**
   * Upload a promo banner image.
   */
  async uploadPromoBanner(file: Express.Multer.File): Promise<UploadResult> {
    return this.uploadFile(file, 'promo-banners', 10);
  }

  /**
   * Upload a gift card shop product image.
   */
  async uploadShopProductImage(file: Express.Multer.File): Promise<UploadResult> {
    return this.uploadFile(file, 'giftcard-shop', 5);
  }

  /**
   * Delete a file from Cloudinary.
   */
  async deleteFile(publicId: string): Promise<boolean> {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      this.logger.log(`File deleted: ${publicId}`);
      return result.result === 'ok';
    } catch (error) {
      this.logger.error('Cloudinary delete error', error);
      return false;
    }
  }
}
