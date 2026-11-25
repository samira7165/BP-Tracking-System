import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { AdminGuard } from '../admin/admin.guard';
import { CreateRecordingDto } from './dto/create-recording.dto';
import { RecordingsService } from './recordings.service';

/** Public: brand promoters send recordings and see whether they arrived, never the result. */
@Controller('recordings')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  /**
   * Upload a video for one of the admin's scripts.
   * multipart/form-data fields: video (file), scriptId, scriptVersion?, speaker?
   */
  @Post()
  @UseInterceptors(FileInterceptor('video'))
  async create(@UploadedFile() file: Express.Multer.File, @Body() dto: CreateRecordingDto) {
    if (!file) throw new BadRequestException('video file is required (field name: "video")');
    return this.recordings.toPromoter(await this.recordings.create(file, dto));
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.recordings.toPromoter(await this.recordings.get(id));
  }
}

@Controller('admin/recordings')
@UseGuards(AdminGuard)
export class AdminRecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Get()
  list() {
    return this.recordings.list();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.recordings.toAdmin(await this.recordings.get(id));
  }

  /** Just the report JSON (handy for other apps). */
  @Get(':id/report')
  async report(@Param('id') id: string) {
    const rec = await this.recordings.get(id);
    if (!rec.report) throw new BadRequestException(`Report not ready yet (status: ${rec.status})`);
    return { id: rec.id, script: rec.script, transcript: rec.transcript?.text, report: rec.report };
  }

  /** Streams the saved video (supports seeking). */
  @Get(':id/video')
  async video(@Param('id') id: string, @Res() res: Response) {
    const rec = await this.recordings.get(id);
    res.type(rec.video.mimeType);
    res.sendFile(rec.video.path);
  }

  /** Run transcription + analysis again (e.g. after fixing the API key). */
  @Post(':id/reprocess')
  @HttpCode(202)
  async reprocess(@Param('id') id: string) {
    return this.recordings.toAdmin(await this.recordings.reprocess(id));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.recordings.remove(id);
  }
}
