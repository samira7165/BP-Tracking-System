import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import { rename, writeFile } from 'fs/promises';
import { join } from 'path';
import { DEFAULT_REPORT_PROMPT } from '../analysis/report-prompt';
import { friendlyGeminiError, GeminiClient, isKeyRejected } from '../common/gemini';
import { DATA_DIR, ensureDirs } from '../common/paths';
import { DatabaseService } from '../database/database.service';

interface Secrets {
  geminiApiKey?: string;
}

/**
 * Settings the admin can change from the dashboard. The prompt is in MySQL. The API key is in
 * data/settings.json instead, so it cannot be read in phpMyAdmin.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly file = join(DATA_DIR, 'settings.json');
  private settings: Secrets = {};
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
  ) {
    ensureDirs();
    if (!existsSync(this.file)) return;
    try {
      this.settings = { geminiApiKey: JSON.parse(readFileSync(this.file, 'utf8')).geminiApiKey };
    } catch (e) {
      this.logger.error(`Could not read ${this.file}: ${(e as Error).message}`);
    }
  }

  /** null when no API key has been added yet. Always uses the latest key, no restart needed. */
  gemini(): GeminiClient | null {
    const key = this.key();
    return key ? this.client(key) : null;
  }

  async reportPrompt(): Promise<string> {
    const [row] = await this.db.query<{ value: string }>("SELECT value FROM settings WHERE name = 'report_prompt'");
    return row?.value || DEFAULT_REPORT_PROMPT;
  }

  /** What the dashboard shows. The key itself never leaves the server. */
  async toPublic() {
    const key = this.key();
    const text = await this.reportPrompt();
    return {
      apiKey: {
        source: this.settings.geminiApiKey ? 'dashboard' : key ? 'env' : null,
        lastFour: key ? key.slice(-4) : null,
      },
      prompt: {
        text,
        defaultText: DEFAULT_REPORT_PROMPT,
        isDefault: text === DEFAULT_REPORT_PROMPT,
      },
    };
  }

  /** Saves the key unless Google says it is wrong. Returns a warning if it could not be checked. */
  async saveApiKey(key: string): Promise<string | null> {
    let warning: string | null = null;
    try {
      await this.client(key).checkKey();
    } catch (e) {
      if (isKeyRejected(e)) {
        throw new BadRequestException('Google did not accept this key. Check that you copied all of it.');
      }
      warning = friendlyGeminiError(e);
    }
    this.settings.geminiApiKey = key;
    await this.flush();
    this.logger.log('Gemini API key updated from the dashboard');
    return warning;
  }

  async removeApiKey() {
    delete this.settings.geminiApiKey;
    await this.flush();
    this.logger.log('Gemini API key removed from the dashboard');
  }

  /** An empty prompt goes back to the default. */
  async savePrompt(prompt: string) {
    if (!prompt || prompt === DEFAULT_REPORT_PROMPT) {
      await this.db.query("DELETE FROM settings WHERE name = 'report_prompt'");
    } else {
      await this.db.query("REPLACE INTO settings SET name = 'report_prompt', value = ?, updated_at = ?", [prompt, new Date()]);
    }
  }

  private key(): string | undefined {
    return this.settings.geminiApiKey || this.config.get<string>('GEMINI_API_KEY')?.trim() || undefined;
  }

  private client(key: string): GeminiClient {
    return new GeminiClient(key, this.config.get<string>('GEMINI_BASE_URL') || undefined);
  }

  private flush(): Promise<void> {
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        const tmp = this.file + '.tmp';
        // Holds a secret: readable by this user only (where the OS supports it)
        await writeFile(tmp, JSON.stringify(this.settings, null, 2), { encoding: 'utf8', mode: 0o600 });
        await rename(tmp, this.file);
      });
    return this.writing;
  }
}
