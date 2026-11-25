import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class SaveScriptDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'title is required' })
  @MaxLength(200)
  title!: string;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'script text is required' })
  @MaxLength(50000)
  text!: string;

  /** ISO-639-1 code, e.g. "en" or "bn". Leave empty for auto-detect. */
  @Trim()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
