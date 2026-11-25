import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, stat } from 'fs/promises';
import { RetakeError } from '../common/retake-error';
import { Transcript } from '../recordings/recording.types';
import { SettingsService } from '../settings/settings.service';
import { ExtractedAudio } from './audio-extractor.service';

/** Gemini takes 20 MB per request, and base64 makes the audio a third bigger. About an hour of speech. */
const MAX_AUDIO_BYTES = 14.5 * 1024 * 1024;
const TIMEOUT_MS = 5 * 60 * 1000;
const LANGUAGE_CODES: Record<string, string> = { en: 'en-US', bn: 'bn-BD' };

/** Step 2: turns the extracted audio into English or Bangla text. */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  private readonly model: string;

  constructor(
    private readonly settings: SettingsService,
    config: ConfigService,
  ) {
    this.model = config.get<string>('TRANSCRIBE_MODEL') || 'gemini-3.5-transcribe';
  }

  async transcribe(audio: ExtractedAudio, language?: string): Promise<Transcript> {
    const gemini = this.settings.gemini();
    if (!gemini) {
      throw new Error('No Gemini API key has been added yet. An admin can add one in Settings.');
    }
    if ((await stat(audio.path)).size > MAX_AUDIO_BYTES) {
      throw new RetakeError('This recording is too long. Record a video shorter than one hour.');
    }

    // Both languages unless the admin picked one for the script. The script itself is
    // not sent here, so the text is what was really said.
    const languageCodes = language && LANGUAGE_CODES[language] ? [LANGUAGE_CODES[language]] : Object.values(LANGUAGE_CODES);
    this.logger.log(`Transcribing with ${this.model} (${languageCodes.join(', ')})`);
    const text = (
      await gemini.generate(
        {
          model: this.model,
          input: [{ type: 'audio', data: (await readFile(audio.path)).toString('base64'), mime_type: 'audio/mp3' }],
          generation_config: { transcription_config: { language_codes: languageCodes, mode: 'verbatim' } },
        },
        TIMEOUT_MS,
      )
    ).trim();

    if (!text) throw new RetakeError('No speech was heard in this recording. Check the microphone and record again.');
    return { text, language: detectLanguage(text), durationSec: audio.durationSec, segments: [], model: this.model };
  }
}

/** Whichever alphabet the text mostly uses. */
function detectLanguage(text: string): string {
  const bangla = text.match(/\p{Script=Bengali}/gu)?.length ?? 0;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return bangla > latin ? 'bn' : 'en';
}
