import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';
import { AdminGuard } from '../admin/admin.guard';
import { SettingsService } from './settings.service';

const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : value));

class ApiKeyDto {
  @Trim()
  @IsString()
  @Matches(/^(?!sk-)[A-Za-z0-9._-]{20,300}$/, { message: 'This does not look like a Gemini API key. Copy it again from Google AI Studio.' })
  apiKey!: string;
}

class PromptDto {
  @Trim()
  @IsString()
  @MaxLength(8000, { message: 'The prompt can be at most 8000 characters.' })
  prompt!: string;
}

@Controller('admin/settings')
@UseGuards(AdminGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.toPublic();
  }

  @Put('api-key')
  async saveApiKey(@Body() dto: ApiKeyDto) {
    const warning = await this.settings.saveApiKey(dto.apiKey);
    return { ...(await this.settings.toPublic()), warning };
  }

  @Delete('api-key')
  async removeApiKey() {
    await this.settings.removeApiKey();
    return this.settings.toPublic();
  }

  @Put('prompt')
  async savePrompt(@Body() dto: PromptDto) {
    await this.settings.savePrompt(dto.prompt);
    return this.settings.toPublic();
  }
}
