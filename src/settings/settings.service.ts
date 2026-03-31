import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppSetting, AppSettingDocument, SettingCategory } from './schemas/app-setting.schema';
import { BulkUpdateSettingsDto } from './dto';

interface DefaultSetting {
  key: string;
  value: any;
  category: SettingCategory;
  isPublic: boolean;
  description: string;
  valueType: string;
}

const DEFAULT_SETTINGS: DefaultSetting[] = [
  {
    key: 'app_name',
    value: 'Zinkite',
    category: SettingCategory.GENERAL,
    isPublic: true,
    description: 'Application display name',
    valueType: 'string',
  },
  {
    key: 'paystack_public_key',
    value: '',
    category: SettingCategory.PAYMENT,
    isPublic: true,
    description: 'Paystack public key for mobile payments',
    valueType: 'string',
  },
  {
    key: 'feature_google_signin',
    value: false,
    category: SettingCategory.FEATURES,
    isPublic: true,
    description: 'Enable Google sign-in on mobile',
    valueType: 'boolean',
  },
  {
    key: 'feature_apple_signin',
    value: false,
    category: SettingCategory.FEATURES,
    isPublic: true,
    description: 'Enable Apple sign-in on mobile',
    valueType: 'boolean',
  },
  {
    key: 'feature_crypto_trading',
    value: true,
    category: SettingCategory.FEATURES,
    isPublic: true,
    description: 'Enable crypto trading feature',
    valueType: 'boolean',
  },
  {
    key: 'feature_gift_cards',
    value: true,
    category: SettingCategory.FEATURES,
    isPublic: true,
    description: 'Enable gift card trading feature',
    valueType: 'boolean',
  },
  {
    key: 'feature_vtu',
    value: true,
    category: SettingCategory.FEATURES,
    isPublic: true,
    description: 'Enable VTU (airtime/data) feature',
    valueType: 'boolean',
  },
  {
    key: 'feature_electricity',
    value: true,
    category: SettingCategory.FEATURES,
    isPublic: true,
    description: 'Enable electricity bill payment feature',
    valueType: 'boolean',
  },
  {
    key: 'minimum_app_version',
    value: '1.0.0',
    category: SettingCategory.APP,
    isPublic: true,
    description: 'Minimum required mobile app version',
    valueType: 'string',
  },
  {
    key: 'latest_app_version',
    value: '1.0.0',
    category: SettingCategory.APP,
    isPublic: true,
    description: 'Latest available mobile app version',
    valueType: 'string',
  },
  {
    key: 'maintenance_mode',
    value: false,
    category: SettingCategory.APP,
    isPublic: true,
    description: 'Put mobile app into maintenance mode',
    valueType: 'boolean',
  },
  {
    key: 'maintenance_message',
    value: 'We are undergoing maintenance. Please check back shortly.',
    category: SettingCategory.APP,
    isPublic: true,
    description: 'Message shown during maintenance mode',
    valueType: 'string',
  },
  {
    key: 'support_email',
    value: 'support@zinkite.com',
    category: SettingCategory.SUPPORT,
    isPublic: true,
    description: 'Customer support email address',
    valueType: 'string',
  },
  {
    key: 'support_phone',
    value: '',
    category: SettingCategory.SUPPORT,
    isPublic: true,
    description: 'Customer support phone number',
    valueType: 'string',
  },
  {
    key: 'support_whatsapp',
    value: '',
    category: SettingCategory.SUPPORT,
    isPublic: true,
    description: 'Customer support WhatsApp number',
    valueType: 'string',
  },
];

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectModel(AppSetting.name)
    private readonly settingModel: Model<AppSettingDocument>,
  ) {}

  async onModuleInit() {
    await this.seedDefaults();
  }

  private async seedDefaults() {
    const ops = DEFAULT_SETTINGS.map((s) => ({
      updateOne: {
        filter: { key: s.key },
        update: { $setOnInsert: s },
        upsert: true,
      },
    }));

    const result = await this.settingModel.bulkWrite(ops);
    this.logger.log(
      `Settings seeded (${DEFAULT_SETTINGS.length} defaults checked, ${result.upsertedCount} new)`,
    );
  }

  async getAllSettings(): Promise<AppSettingDocument[]> {
    return this.settingModel.find().sort({ category: 1, key: 1 }).exec();
  }

  async getPublicSettings(): Promise<Record<string, any>> {
    const settings = await this.settingModel
      .find({ isPublic: true })
      .select('key value')
      .lean()
      .exec();

    const map: Record<string, any> = {};
    for (const s of settings) {
      map[s.key] = s.value;
    }
    return map;
  }

  async bulkUpdate(dto: BulkUpdateSettingsDto): Promise<{ updated: number }> {
    let updated = 0;

    for (const item of dto.settings) {
      const result = await this.settingModel.updateOne(
        { key: item.key },
        { $set: { value: item.value } },
      );
      if (result.modifiedCount > 0) {
        updated++;
      }
    }

    return { updated };
  }
}
