import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import { basename, extname, join } from 'path';
import { AUDIO_DIR } from '../common/paths';
import { RetakeError } from '../common/retake-error';

const TIMEOUT_MS = 10 * 60 * 1000;

export interface ExtractedAudio {
  path: string;
  durationSec?: number;
}

/**
 * Step 1: pulls a small mono MP3 out of the video with ffmpeg.
 * Only this audio is ever sent to the speech-to-text API, never the video.
 */
@Injectable()
export class AudioExtractorService {
  private readonly logger = new Logger(AudioExtractorService.name);
  private readonly ffmpegPath: string;

  constructor(config: ConfigService) {
    this.ffmpegPath = config.get<string>('FFMPEG_PATH') || this.bundledFfmpeg() || 'ffmpeg';
  }

  async extract(videoPath: string): Promise<ExtractedAudio> {
    if (!existsSync(videoPath)) throw new Error('The video file is missing on the server.');
    const out = join(AUDIO_DIR, basename(videoPath, extname(videoPath)) + '.mp3');
    let output: string;
    try {
      output = await this.run(['-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', out]);
    } catch (e) {
      const message = (e as Error).message;
      this.logger.warn(`ffmpeg failed: ${message}`);
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('The audio tool (ffmpeg) is not installed on the server.');
      if (/does not contain any stream/i.test(message)) throw new RetakeError('This video has no sound. Record again with the microphone on.');
      throw new RetakeError('The sound could not be read from this video. The file may be damaged. Record again.');
    }
    this.logger.log(`Extracted audio ${basename(out)} (${(statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);
    return { path: out, durationSec: lastTimestamp(output) };
  }

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], timeout: TIMEOUT_MS });
      let stderr = '';
      proc.stderr.on('data', (d) => (stderr = (stderr + d.toString()).slice(-4000)));
      proc.on('error', reject);
      proc.on('close', (code) => (code === 0 ? resolve(stderr) : reject(new Error(`exit code ${code}: ${stderr.slice(-600)}`))));
    });
  }

  private bundledFfmpeg(): string | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const p = require('ffmpeg-static');
      return typeof p === 'string' ? p : null;
    } catch {
      return null;
    }
  }
}

/** ffmpeg ends its output with the position it reached, e.g. "time=00:01:02.50". */
function lastTimestamp(output: string): number | undefined {
  const match = [...output.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].pop();
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : undefined;
}
