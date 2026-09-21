import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { VtuProductType, VtuTransactionStatus } from '../schemas/vtu-transaction.schema';

// Strip everything the user might have typed around the digits — spaces,
// dashes, brackets, dots. Legacy user rows store phones in a mix of formats
// (registration only enforces @IsString, so anything went in). We normalise
// here so the @Matches regex can focus on the digit shape, not the display.
const normalizePhone = ({ value }: { value: string }) =>
  String(value || '').replace(/[\s\-()\.]/g, '');

export class PurchaseAirtimeDto {
  @IsIn(['mtn', 'glo', 'airtel', 'etisalat']) network: string;
  @Transform(normalizePhone) @Matches(/^(?:\+?234|0)?[789]\d{9}$/) phone: string;
  @IsNumber() @IsInt() @Min(50) @Max(50000) amount: number;
}

export class PurchaseDataDto {
  @IsIn(['mtn', 'glo', 'airtel', 'etisalat']) network: string;
  @Transform(normalizePhone) @Matches(/^(?:\+?234|0)?[789]\d{9}$/) phone: string;
  @IsString() variationCode: string;
}

export class VerifyCustomerDto {
  @IsString() serviceId: string;
  @IsString() billersCode: string;
  @IsOptional() @IsString() type?: string;
}

export class PurchaseElectricityDto {
  @IsString() serviceId: string;

  // Strip spaces + non-digits from meter number before validation. Users
  // paste from bills that sometimes include dashes or spaces.
  @IsString()
  @Transform(({ value }) => String(value || '').replace(/\D/g, ''))
  @Matches(/^\d{1,13}$/, { message: 'Meter number must contain no more than 13 digits' })
  meterNumber: string;

  // Accept "PREPAID"/"Prepaid"/"prepaid" from any client — VTpass expects
  // lowercase. Do the case-normalise BEFORE @IsIn checks.
  @IsString()
  @Transform(({ value }) => String(value || '').trim().toLowerCase())
  @IsIn(['prepaid', 'postpaid'])
  meterType: string;

  // Coerce string amounts to number so a mobile client that stringifies the
  // amount does not trip the @IsNumber check.
  @Type(() => Number)
  @IsNumber()
  @Min(100)
  @Max(500000)
  amount: number;

  // Kept optional for compatibility with mobile builds deployed while the
  // electricity notification-phone field was being removed. The service
  // always prefers the authenticated user's profile phone.
  @IsOptional()
  @Transform(normalizePhone)
  // Accept every Nigerian mobile shape we know about: `+2348012345678`,
  // `2348012345678`, `08012345678`, and `8012345678`. The service normalises
  // to VTpass's expected format before dispatch, so we only care that this
  // *looks like* a Nigerian mobile.
  @Matches(/^(?:\+?234|0)?[789]\d{9}$/)
  phone?: string;
}

export class PurchaseTvDto {
  @IsIn(['dstv', 'gotv', 'startimes', 'showmax']) serviceId: string;
  @IsString() smartcardNumber: string;
  @IsString() variationCode: string;
  // Showmax uses `smartcardNumber` as the account phone number and does not
  // require a second notification-phone argument. Keep this optional so both
  // current and older mobile builds can submit the documented Showmax shape.
  @IsOptional()
  @Transform(normalizePhone)
  // Accept every Nigerian mobile shape we know about: `+2348012345678`,
  // `2348012345678`, `08012345678`, and `8012345678`. The service normalises
  // to VTpass's expected format before dispatch, so we only care that this
  // *looks like* a Nigerian mobile.
  @Matches(/^(?:\+?234|0)?[789]\d{9}$/)
  phone?: string;
}

export class VtuQueryDto {
  @IsOptional() @IsEnum(VtuProductType) type?: VtuProductType;
  @IsOptional() @IsEnum(VtuTransactionStatus) status?: VtuTransactionStatus;
  @IsOptional() @IsString() userId?: string;
  // Query-string params always arrive as strings — force numeric coercion
  // BEFORE @IsNumber runs, otherwise validation fails with "must be a number".
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 20;
}
