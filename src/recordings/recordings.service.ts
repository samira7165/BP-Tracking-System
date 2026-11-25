import { ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import { friendlyGeminiError } from '../common/gemini';
import { RetakeError } from '../common/retake-error';
import { AnalysisService } from '../analysis/analysis.service';
import { Script } from '../scripts/script.types';
import { ScriptsService } from '../scripts/scripts.service';
import { AudioExtractorService } from '../transcription/audio-extractor.service';
import { TranscriptionService } from '../transcription/transcription.service';
import { CreateRecordingDto } from './dto/create-recording.dto';
import { ProcessingQueue } from './processing-queue';
import { Recording } from './recording.types';
import { RecordingsStore } from './recordings.store';

const MAX_ATTEMPTS = 3;
const RECOVER_EVERY_MS = 30 * 1000;

@Injectable()
export class RecordingsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RecordingsService.name);
  /** Takes go to the AI one by one, in the order they arrived. */
  private readonly queue = new ProcessingQueue((id) => this.process(id));
  private recoverTimer?: NodeJS.Timeout;

  constructor(
    private readonly store: RecordingsStore,
    private readonly scripts: ScriptsService,
    private readonly audio: AudioExtractorService,
    private readonly transcription: TranscriptionService,
    private readonly analysis: AnalysisService,
  ) {}

  async onApplicationBootstrap() {
    await this.recover();
    this.recoverTimer = setInterval(() => void this.recover(), RECOVER_EVERY_MS);
  }

  onModuleDestroy() {
    clearInterval(this.recoverTimer);
  }

  /** Continues the line after the server or the database went down. */
  private async recover() {
    try {
      // Looked up first: one that finishes while we ask the database must not be added again
      const known = new Set(this.queue.ids());
      const lost = (await this.store.unfinished()).filter((r) => !known.has(r.id) && !this.queue.has(r.id));
      for (const rec of lost) {
        if (rec.attempts >= MAX_ATTEMPTS) {
          await this.store.update(rec.id, { status: 'failed', error: 'The server stopped several times while checking this recording. Press Re-run to try again.' });
        } else {
          await this.store.update(rec.id, { status: 'queued' });
          this.queue.add(rec.id);
        }
      }
      if (lost.length) this.logger.log(`Continuing with ${lost.length} unfinished recording(s)`);
    } catch {
      // Database is off: logged there, tried again later
    }
  }

  async create(file: Express.Multer.File, dto: CreateRecordingDto): Promise<Recording> {
    let script: Script;
    try {
      script = await this.scriptFor(dto);
    } catch (e) {
      // Multer has already written the file, so don't leave it behind.
      await unlink(file.path).catch(() => undefined);
      throw e;
    }

    const now = new Date().toISOString();
    const rec: Recording = {
      id: randomUUID(),
      title: script.title,
      scriptId: script.id,
      speaker: dto.speaker?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      queuedAt: now,
      script: script.text,
      language: script.language,
      video: {
        fileName: file.filename,
        path: file.path,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        originalName: file.originalname,
      },
    };
    try {
      await this.store.insert(rec);
    } catch (e) {
      await unlink(file.path).catch(() => undefined);
      throw e;
    }
    this.logger.log(`Saved video ${rec.id} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);

    // The client polls for its place in line and the result.
    this.queue.add(rec.id);
    return rec;
  }

  /** The script text always comes from the admin's copy, never from the uploader. */
  private async scriptFor(dto: CreateRecordingDto): Promise<Script> {
    const script = (await this.scripts.active()).find((s) => s.id === dto.scriptId);
    if (!script) throw new NotFoundException('This script is no longer available. Please choose another one.');
    if (dto.scriptVersion && dto.scriptVersion !== script.updatedAt) {
      throw new ConflictException(
        'The script was changed while you were recording. Read the new version, then record again or send this one.',
      );
    }
    return script;
  }

  async list() {
    return (await this.store.list()).map((r) => ({ ...r, queue: this.queue.position(r.id) ?? undefined }));
  }

  async get(id: string): Promise<Recording> {
    const rec = await this.store.get(id);
    if (!rec) throw new NotFoundException(`Recording ${id} not found`);
    return rec;
  }

  async reprocess(id: string) {
    const rec = await this.get(id);
    if (this.queue.has(id)) return rec; // already waiting or being checked
    await this.store.update(id, {
      status: 'queued',
      queuedAt: new Date().toISOString(),
      attempts: 0,
      error: undefined,
      needsRetake: undefined,
      report: undefined,
      transcript: undefined,
    });
    this.queue.add(id);
    return this.get(id);
  }

  async remove(id: string) {
    const rec = await this.get(id);
    this.queue.remove(id);
    await unlink(rec.video.path).catch(() => undefined);
    await this.store.remove(id);
  }

  /** The pipeline: 1. video -> audio, 2. audio -> English or Bangla text, 3. text -> AI report */
  private async process(id: string): Promise<boolean> {
    const rec = await this.store.get(id);
    if (!rec) return false; // deleted while waiting
    try {
      await this.store.update(id, { status: 'extracting_audio', attempts: (rec.attempts ?? 0) + 1 });
      const audio = await this.audio.extract(rec.video.path);

      await this.store.update(id, { status: 'transcribing' });
      const transcript = await this.transcription
        .transcribe(audio, rec.language)
        // Only needed for this step; a re-run extracts it again
        .finally(() => unlink(audio.path).catch(() => undefined));

      await this.store.update(id, { transcript, status: 'analyzing' });

      const report = await this.analysis.analyze(rec.script, transcript.text, rec.language ?? transcript.language);
      await this.store.update(id, { report, status: 'done' });
      this.logger.log(`Recording ${id} done: ${report.verdict} (${report.overallScore}/100)`);
      return true;
    } catch (e) {
      // Database went away: recover() puts it back in line
      if (e instanceof ServiceUnavailableException) throw e;
      const message = friendlyGeminiError(e);
      this.logger.error(`Recording ${id} failed: ${message}`);
      await this.store.update(id, { status: 'failed', error: message, needsRetake: e instanceof RetakeError });
      return false;
    }
  }

  /** What a brand promoter may know: that it arrived, or that it has to be recorded again. */
  toPromoter(rec: Recording) {
    const finished = rec.status === 'done' || rec.status === 'failed';
    const status = rec.status === 'failed' && rec.needsRetake ? 'retake' : finished ? 'received' : 'checking';
    return {
      id: rec.id,
      title: rec.title,
      createdAt: rec.createdAt,
      status,
      message: status === 'retake' ? rec.error : undefined,
    };
  }

  /** What the dashboard shows (hides the server file path). */
  toAdmin(rec: Recording) {
    const { video, attempts: _attempts, ...rest } = rec;
    return {
      ...rest,
      queue: this.queue.position(rec.id) ?? undefined,
      videoUrl: `/api/admin/recordings/${rec.id}/video`,
      video: { mimeType: video.mimeType, sizeBytes: video.sizeBytes, originalName: video.originalName },
    };
  }
}
