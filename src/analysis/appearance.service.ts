import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { friendlyGeminiError } from '../common/gemini';
import { Appearance, Snapshot } from '../recordings/recording.types';
import { SettingsService } from '../settings/settings.service';

const TIMEOUT_MS = 2 * 60 * 1000;

const prompt = (dressCode: string) => `You look at 3 snapshots taken from a video of a brand promoter (BP) presenting a brand to customers.
The BP talks to the customers, not to the camera. The camera only records them, often from the side.
Never count it against the BP that they do not look at the camera, or the camera angle.
Judge from what you can see in the snapshots together:
- attire: ${
  dressCode
    ? `does the BP follow this dress code? "${dressCode}". Say which part is missing or wrong.`
    : 'is the BP dressed neatly and professionally for promoting a brand?'
}
- expression: friendly, smiling and engaged, or flat, bored, angry or nervous?
- bodyLanguage: upright, open and turned towards the customer, with natural gestures? Or slouching,
  arms crossed, hands in pockets, leaning on things, using a phone, or turned away?
Rate each "good", "fair" or "poor", with one short note about what you saw.
Do not comment on looks, body shape, skin colour, age, gender or anything else a person cannot change.
If the BP cannot be seen in any snapshot, set personVisible to false, score 0 and say so in the summary.
Give an overall score from 0 to 100, a 1-2 sentence summary, what they did well and what to improve.
Write in English.`;

const RATING = { type: 'object', properties: { rating: { type: 'string', enum: ['good', 'fair', 'poor'] }, note: { type: 'string' } }, required: ['rating', 'note'] };
const ASPECTS = ['attire', 'expression', 'bodyLanguage'] as const;
const SCHEMA = {
  type: 'object',
  properties: {
    personVisible: { type: 'boolean' },
    score: { type: 'integer' },
    summary: { type: 'string' },
    ...Object.fromEntries(ASPECTS.map((a) => [a, RATING])),
    strengths: { type: 'array', items: { type: 'string' } },
    improvements: { type: 'array', items: { type: 'string' } },
  },
  required: ['personVisible', 'score', 'summary', ...ASPECTS, 'strengths', 'improvements'],
};

/** Gemini looks at 3 snapshots and judges the BP's attire, expression and body language. */
@Injectable()
export class AppearanceService {
  private readonly logger = new Logger(AppearanceService.name);
  private readonly model: string;

  constructor(
    private readonly settings: SettingsService,
    config: ConfigService,
  ) {
    this.model = config.get<string>('ANALYSIS_MODEL') || 'gemini-3.5-flash-lite';
  }

  /** Never throws: a failed check shows up in the report instead of failing the recording. */
  async review(snapshots: Snapshot[], paths: string[]): Promise<Appearance> {
    const gemini = this.settings.gemini();
    if (!gemini) return { snapshots, error: 'No Gemini API key, so the snapshots were not checked.' };
    try {
      const images = await Promise.all(
        paths.map(async (p) => ({ type: 'image', data: (await readFile(p)).toString('base64'), mime_type: 'image/jpeg' })),
      );
      const answer = await gemini.generate(
        {
          model: this.model,
          system_instruction: prompt(await this.settings.dressCode()),
          input: [...images, { type: 'text', text: 'Review these 3 snapshots of the brand promoter.' }],
          response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
        },
        TIMEOUT_MS,
      );
      return { snapshots, ...toAppearance(JSON.parse(answer)) };
    } catch (e) {
      this.logger.warn(`Snapshot check failed: ${(e as Error).message}`);
      return { snapshots, error: `The snapshots could not be checked. ${friendlyGeminiError(e)}` };
    }
  }
}

function toAppearance(raw: Record<string, unknown>): Omit<Appearance, 'snapshots'> {
  const score = Number(raw.score);
  if (!Number.isFinite(score)) throw new Error('It sent an answer that could not be read.');
  const aspect = (v: unknown) => {
    const a = (v ?? {}) as { rating?: unknown; note?: unknown };
    const rating = ['good', 'fair', 'poor'].includes(String(a.rating)) ? (String(a.rating) as 'good' | 'fair' | 'poor') : 'fair';
    return { rating, note: String(a.note ?? '') };
  };
  const strings = (v: unknown) => (Array.isArray(v) ? v.map(String).filter((s) => s.trim()) : []);
  return {
    personVisible: raw.personVisible !== false,
    score: Math.max(0, Math.min(100, Math.round(score))),
    summary: String(raw.summary ?? ''),
    aspects: Object.fromEntries(ASPECTS.map((a) => [a, aspect(raw[a])])) as Appearance['aspects'],
    strengths: strings(raw.strengths),
    improvements: strings(raw.improvements),
  };
}
