import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { ApiProperty } from '@nestjs/swagger';

export type AppSettingDocument = AppSetting & Document;

export enum SettingCategory {
  GENERAL = 'GENERAL',
  PAYMENT = 'PAYMENT',
  FEATURES = 'FEATURES',
  APP = 'APP',
  SUPPORT = 'SUPPORT',
}

@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: (_, ret: Record<string, any>) => {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class AppSetting {
  @ApiProperty({ description: 'Unique setting key', example: 'maintenance_mode' })
  @Prop({ required: true, unique: true, trim: true })
  key: string;

  @ApiProperty({ description: 'Setting value (any type)' })
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  value: any;

  @ApiProperty({ description: 'Setting category', enum: SettingCategory })
  @Prop({ type: String, enum: SettingCategory, required: true })
  category: SettingCategory;

  @ApiProperty({ description: 'Whether this setting is exposed to the public API' })
  @Prop({ type: Boolean, default: false })
  isPublic: boolean;

  @ApiProperty({ description: 'Human-readable description' })
  @Prop({ type: String, default: '' })
  description: string;

  @ApiProperty({ description: 'Value type hint', example: 'boolean' })
  @Prop({ type: String, default: 'string' })
  valueType: string;

  createdAt: Date;
  updatedAt: Date;
}

export const AppSettingSchema = SchemaFactory.createForClass(AppSetting);

AppSettingSchema.index({ category: 1 });
AppSettingSchema.index({ isPublic: 1 });
