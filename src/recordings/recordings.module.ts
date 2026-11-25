import { BadRequestException, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { AdminModule } from '../admin/admin.module';
import { AnalysisService } from '../analysis/analysis.service';
import { UPLOADS_DIR, ensureDirs } from '../common/paths';
import { SettingsModule } from '../settings/settings.module';
import { ScriptsModule } from '../scripts/scripts.module';
import { AudioExtractorService } from '../transcription/audio-extractor.service';
import { TranscriptionService } from '../transcription/transcription.service';
import { AdminRecordingsController, RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { RecordingsStore } from './recordings.store';

function extensionFor(file: Express.Multer.File): string {
  const fromName = extname(file.originalname || '').toLowerCase();
  if (fromName) return fromName;
  if (file.mimetype.includes('mp4')) return '.mp4';
  if (file.mimetype.includes('quicktime')) return '.mov';
  if (file.mimetype.includes('ogg')) return '.ogg';
  return '.webm';
}

@Module({
  imports: [
    AdminModule,
    SettingsModule,
    ScriptsModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        ensureDirs();
        const maxMb = Number(config.get('MAX_UPLOAD_MB')) || 200;
        return {
          storage: diskStorage({
            destination: UPLOADS_DIR,
            filename: (_req, file, cb) => cb(null, `${randomUUID()}${extensionFor(file)}`),
          }),
          limits: { fileSize: maxMb * 1024 * 1024 },
          fileFilter: (_req, file, cb) => {
            if (/^(video|audio)\//.test(file.mimetype)) return cb(null, true);
            cb(new BadRequestException('Only video or audio files are allowed'), false);
          },
        };
      },
    }),
  ],
  controllers: [RecordingsController, AdminRecordingsController],
  providers: [
    RecordingsStore,
    RecordingsService,
    AudioExtractorService,
    TranscriptionService,
    AnalysisService,
  ],
})
export class RecordingsModule {}
