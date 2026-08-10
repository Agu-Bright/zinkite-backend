import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { VtuProductType, VtuTransactionStatus } from '../schemas/vtu-transaction.schema';

const normalizePhone = ({ value }: { value: string }) => String(value || '').replace(/\s+/g, '');

export class PurchaseAirtimeDto {
  @IsIn(['mtn', 'glo', 'airtel', 'etisalat']) network: string;
  @Transform(normalizePhone) @Matches(/^(?:\+?234|0)[789]\d{9}$/) phone: string;
  @IsNumber() @IsInt() @Min(50) @Max(50000) amount: number;
}

export class PurchaseDataDto {
  @IsIn(['mtn', 'glo', 'airtel', 'etisalat']) network: string;
  @Transform(normalizePhone) @Matches(/^(?:\+?234|0)[789]\d{9}$/) phone: string;
  @IsString() variationCode: string;
}

export class VerifyCustomerDto {
  @IsString() serviceId: string;
  @IsString() billersCode: string;
  @IsOptional() @IsString() type?: string;
}

export class PurchaseElectricityDto {
  @IsString() serviceId: string;
  @IsString() meterNumber: string;
  @IsIn(['prepaid', 'postpaid']) meterType: string;
  @Transform(normalizePhone) @Matches(/^(?:\+?234|0)[789]\d{9}$/) phone: string;
  @IsNumber() @Min(100) @Max(500000) amount: number;
}

export class PurchaseTvDto {
  @IsIn(['dstv', 'gotv', 'startimes']) serviceId: string;
  @IsString() smartcardNumber: string;
  @IsString() variationCode: string;
  @Transform(normalizePhone) @Matches(/^(?:\+?234|0)[789]\d{9}$/) phone: string;
}

export class VtuQueryDto {
  @IsOptional() @IsEnum(VtuProductType) type?: VtuProductType;
  @IsOptional() @IsEnum(VtuTransactionStatus) status?: VtuTransactionStatus;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsNumber() @Min(1) page = 1;
  @IsOptional() @IsNumber() @Min(1) @Max(100) limit = 20;
}
