import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { friendlyGeminiError, GeminiClient } from '../common/gemini';
import { Report, Verdict } from '../recordings/recording.types';
import { SettingsService } from '../settings/settings.service';
import { buildSystemPrompt, REPORT_SCHEMA } from './report-prompt';
import { compareTexts, DiffResult } from './text-diff';

interface AiResult {
  verdict: Verdict;
  overallScore: number;
  summary: string;
  missingParts: string[];
  addedParts: string[];
  changedParts: { expected: string; spoken: string; note?: string }[];
  suggestions: string[];
}

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);
  private readonly model: string;

  constructor(
    private readonly settings: SettingsService,
    config: ConfigService,
  ) {
    this.model = config.get<string>('ANALYSIS_MODEL') || 'gemini-3.5-flash-lite';
  }

  async analyze(script: string, transcript: string, language?: string): Promise<Report> {
    const diff = compareTexts(script, transcript);
    const base = this.localReport(diff);

    const gemini = this.settings.gemini();
    if (!gemini) {
      return { ...base, warning: 'No Gemini API key, so only the word-by-word comparison was done.' };
    }

    try {
      const ai = await this.askAi(gemini, script, transcript, diff, language);
      return {
        ...base,
        verdict: ai.verdict,
        overallScore: ai.overallScore,
        summary: ai.summary,
        missingParts: ai.missingParts,
        addedParts: ai.addedParts,
        changedParts: ai.changedParts,
        suggestions: ai.suggestions,
        generatedBy: 'ai+local',
        analysisModel: this.model,
      };
    } catch (e) {
      this.logger.warn(`AI analysis failed, using local comparison only: ${(e as Error).message}`);
      return { ...base, warning: `The AI could not review this take. ${friendlyGeminiError(e)} Showing the word-by-word comparison only.` };
    }
  }

  private async askAi(gemini: GeminiClient, script: string, transcript: string, diff: DiffResult, language?: string): Promise<AiResult> {
    const user = [
      language ? `Expected language: ${language}` : '',
      `Word-level match computed by code: ${diff.accuracy}% of script words were spoken in order ` +
        `(${diff.missing} missing, ${diff.changed} changed, ${diff.extra} extra). Use it as a hint, not the final answer.`,
      `SCRIPT:\n"""\n${script}\n"""`,
      `TRANSCRIPT:\n"""\n${transcript || '(no speech detected)'}\n"""`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const answer = await gemini.generate(
      {
        model: this.model,
        system_instruction: buildSystemPrompt(await this.settings.reportPrompt()),
        input: user,
        response_format: { type: 'text', mime_type: 'application/json', schema: REPORT_SCHEMA },
      },
      2 * 60 * 1000,
    );
    const raw = parseAnswer(answer);
    const score = clamp(Number(raw.overallScore), 0, 100);
    const verdicts: Verdict[] = ['MATCHED', 'PARTIALLY_MATCHED', 'NOT_MATCHED'];
    return {
      verdict: verdicts.includes(raw.verdict) ? raw.verdict : verdictFromScore(score),
      overallScore: score,
      summary: String(raw.summary ?? ''),
      missingParts: strings(raw.missingParts),
      addedParts: strings(raw.addedParts),
      changedParts: Array.isArray(raw.changedParts)
        ? raw.changedParts
            .filter((c: unknown) => c && typeof c === 'object')
            .map((c: { expected?: unknown; spoken?: unknown; note?: unknown }) => ({
              expected: String(c.expected ?? ''),
              spoken: String(c.spoken ?? ''),
              note: c.note ? String(c.note) : undefined,
            }))
        : [],
      suggestions: strings(raw.suggestions),
    };
  }

  private localReport(diff: DiffResult): Report {
    const score = Math.round(diff.accuracy);
    return {
      verdict: verdictFromScore(score),
      overallScore: score,
      wordAccuracy: diff.accuracy,
      stats: {
        scriptWords: diff.scriptWords,
        spokenWords: diff.spokenWords,
        matchedWords: diff.matched,
        missingWords: diff.missing,
        extraWords: diff.extra,
        changedWords: diff.changed,
      },
      summary: `${diff.matched} of ${diff.scriptWords} script words were spoken in the right order (${diff.accuracy}%).`,
      missingParts: diff.chunks.filter((c) => c.type === 'missing').map((c) => c.expected!),
      addedParts: diff.chunks.filter((c) => c.type === 'extra').map((c) => c.spoken!),
      changedParts: diff.chunks
        .filter((c) => c.type === 'changed')
        .map((c) => ({ expected: c.expected!, spoken: c.spoken! })),
      suggestions: [],
      diff: diff.chunks,
      generatedBy: 'local-only',
      generatedAt: new Date().toISOString(),
    };
  }
}

/** An answer we cannot read must not turn into a score of 0. */
function parseAnswer(answer: string) {
  try {
    const raw = JSON.parse(answer);
    if (Number.isFinite(Number(raw?.overallScore))) return raw;
  } catch {
    // falls through
  }
  throw new Error('It sent an answer that could not be read.');
}

function clamp(n: number, min: number, max: number) {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : 0;
}

function verdictFromScore(score: number): Verdict {
  if (score >= 85) return 'MATCHED';
  if (score >= 50) return 'PARTIALLY_MATCHED';
  return 'NOT_MATCHED';
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter((s) => s.trim()) : [];
}
