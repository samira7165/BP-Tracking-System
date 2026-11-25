import { Logger } from '@nestjs/common';

const MAX_TRIES = 3;
const logger = new Logger('Gemini');

export class GeminiError extends Error {
  constructor(
    /** HTTP status, or 0 when Google could not be reached */
    readonly status: number,
    /** e.g. "API_KEY_INVALID", "quota_exceeded", "RESOURCE_EXHAUSTED" */
    readonly code: string,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

export interface GeminiRequest {
  model: string;
  input: unknown;
  system_instruction?: string;
  response_format?: unknown;
  generation_config?: unknown;
}

/** Small client for the Gemini Interactions API. */
export class GeminiClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  ) {}

  /** Runs one request, trying again after temporary problems. Returns the text Gemini wrote. */
  async generate(request: GeminiRequest, timeoutMs: number): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      try {
        // store: false = Google does not keep the recording or the answer for later retrieval
        return outputText(await this.call('POST', '/interactions', timeoutMs, { ...request, store: false }));
      } catch (e) {
        if (attempt === MAX_TRIES || !isTemporary(e)) throw e;
        const waitSec = e.status === 429 ? Math.min(e.retryAfterSec ?? 15 * attempt, 60) : 1.5 * attempt;
        logger.warn(`Attempt ${attempt} failed (${e.status} ${e.code}), trying again in ${waitSec}s`);
        await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
      }
    }
  }

  /** Throws when Google does not accept the key. Free. */
  async checkKey(): Promise<void> {
    await this.call('GET', '/models?pageSize=1', 10000);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async call(method: string, path: string, timeoutMs: number, body?: object): Promise<any> {
    let res: Response;
    let text: string;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        // The key goes in a header, never in the URL, so it cannot end up in logs
        headers: { 'x-goog-api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await res.text();
    } catch (e) {
      throw new GeminiError(0, (e as Error).name, 'Could not reach Gemini');
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    if (!res.ok) {
      // Comes as {error}, or as [{error}]
      const error = (Array.isArray(data) ? data[0] : data)?.error ?? {};
      const reason = error.details?.find((d: { reason?: string }) => d.reason)?.reason;
      const code = reason ?? (typeof error.code === 'string' ? error.code : error.status) ?? '';
      throw new GeminiError(res.status, code, error.message ?? res.statusText, Number(res.headers.get('retry-after')) || undefined);
    }
    if (data === undefined) throw new GeminiError(502, 'bad_response', 'Gemini sent an unreadable answer');
    return data;
  }
}

interface Interaction {
  status?: string;
  errors?: { code?: string; message?: string }[];
  steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
}

function outputText(interaction: Interaction): string {
  const text = (interaction.steps ?? [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('');
  if (interaction.status === 'completed') return text;
  const error = interaction.errors?.[0];
  throw new GeminiError(422, error?.code ?? interaction.status ?? 'unknown', error?.message ?? `Gemini stopped early (${interaction.status})`);
}

/** Lost connection, rate limit or an outage. Not a used-up daily quota. */
function isTemporary(e: unknown): e is GeminiError {
  if (!(e instanceof GeminiError)) return false;
  return e.status === 0 || e.status >= 500 || (e.status === 429 && !isDailyQuota(e));
}

const isDailyQuota = (e: GeminiError) => e.code === 'quota_exceeded' || /per ?day|daily/i.test(e.message);

export function isKeyRejected(e: unknown): boolean {
  if (!(e instanceof GeminiError)) return false;
  return e.status === 401 || e.code === 'API_KEY_INVALID' || /reported as leaked/i.test(e.message);
}

/** Plain-English version of a failure. Speakers can see these, so Google's own text is not passed on. */
export function friendlyGeminiError(e: unknown): string {
  if (!(e instanceof GeminiError)) return (e as Error)?.message || 'Unknown error';
  logger.warn(`${e.status} ${e.code}: ${e.message}`);
  if (isKeyRejected(e)) return 'Google did not accept the Gemini API key. An admin needs to update it in Settings.';
  if (e.status === 0) return 'Could not reach Gemini. Check the internet connection and try again.';
  if (e.status === 402) return 'The Gemini account is out of credit. An admin needs to add credit in Google AI Studio.';
  if (e.status === 403) return 'The Gemini API key is not allowed to do this. An admin needs to check it in Google AI Studio.';
  if (e.status === 404) return 'The Gemini model set for this site is not available to this API key.';
  if (e.status === 429) {
    return isDailyQuota(e)
      ? 'The Gemini limit for today is used up. Try again tomorrow, or an admin can turn on billing in Google AI Studio.'
      : 'Gemini is receiving too many requests. Wait a minute and try again.';
  }
  if (e.status >= 500) return 'Gemini is having problems right now. Try again in a few minutes.';
  if (e.code === 'incomplete') return 'This recording is too long for Gemini to finish. Record a shorter video.';
  return 'Gemini could not process this take. Try again, or ask the admin to check the server log.';
}
