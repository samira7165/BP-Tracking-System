import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRecordingDto {
  /** Which admin-written script this video should match. */
  @IsString()
  @IsNotEmpty({ message: 'scriptId is required' })
  @MaxLength(100)
  scriptId!: string;

  /** The script's updatedAt as the speaker saw it, so we can tell if it was edited meanwhile. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  scriptVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  speaker?: string;
}
