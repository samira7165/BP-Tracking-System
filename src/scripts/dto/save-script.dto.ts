import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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

  /** Words or phrases the brand promoter must say. Blank ones and repeats are dropped. */
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? [...new Set(value.map((k) => (typeof k === 'string' ? k.trim().replace(/\s+/g, ' ') : k)).filter((k) => k !== ''))] : value,
  )
  @IsArray()
  @ArrayMaxSize(30, { message: 'A script can have at most 30 keywords.' })
  @IsString({ each: true })
  @MaxLength(100, { each: true, message: 'A keyword can be at most 100 characters.' })
  keywords?: string[];
}
