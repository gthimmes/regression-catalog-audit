import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { areaSchema } from "../config/schema.js";
import { CredentialError } from "../errors.js";
import {
  SYSTEM_PROMPT,
  coverageJudgmentPrompt,
  mappingSuggestionPrompt,
} from "./prompts.js";

/**
 * Anthropic API client for the optional --ai features. Uses native fetch (no
 * SDK per SPEC). Every AI path degrades gracefully: on repeated malformed
 * output the caller receives `null` / an "unavailable" marker and the audit is
 * unaffected (advisory only).
 */

export const DEFAULT_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export interface AiClientOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  maxTokens?: number;
}

export interface CoverageJudgment {
  rating: number;
  suggestions: string[];
}

const coverageSchema = z.object({
  rating: z.number(),
  suggestions: z.array(z.string()).default([]),
});

// Accept either a bare areas array or a { areas: [...] } object from the model.
const suggestedAreasSchema = z.union([
  z.object({ areas: z.array(areaSchema).min(1) }).transform((o) => o.areas),
  z.array(areaSchema).min(1),
]);

export class AiClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxTokens: number;

  constructor(opts: AiClientOptions) {
    if (!opts.apiKey) {
      throw new CredentialError(
        "ANTHROPIC_API_KEY is required for --ai features",
      );
    }
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? process.env.CATALOG_AUDIT_MODEL ?? DEFAULT_MODEL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxTokens = opts.maxTokens ?? 2048;
  }

  /** One raw completion. Returns the assistant text, or null on transport error. */
  private async complete(userMessage: string): Promise<string | null> {
    let res: Response;
    try {
      res = await this.fetchImpl(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.maxTokens,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        }),
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;

    try {
      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = (data.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");
      return text || null;
    } catch {
      return null;
    }
  }

  /**
   * Propose `areas` YAML for unmapped paths. Returns the validated YAML string
   * to display (never auto-applied), or null if the model output can't be
   * parsed+validated after one corrective retry.
   */
  async suggestMappings(
    unmappedPaths: string[],
    folders: string[],
  ): Promise<string | null> {
    const base = mappingSuggestionPrompt({ unmappedPaths, folders });
    return this.tryTwice(base, (text): string | undefined => {
      const yaml = extractFenced(text, ["yaml", "yml", ""]);
      if (!yaml) return undefined;
      const parsed = parseYamlSafe(yaml);
      if (parsed === undefined) return undefined;
      const result = suggestedAreasSchema.safeParse(parsed);
      if (!result.success) return undefined;
      return yaml.trim();
    });
  }

  /**
   * Rate plausible coverage (0–100) and suggest up to 5 case titles for a
   * coverage-gap area. Advisory only; returns null if unavailable.
   */
  async judgeCoverage(
    areaName: string,
    commitSubjects: string[],
    caseTitles: string[],
  ): Promise<CoverageJudgment | null> {
    const base = coverageJudgmentPrompt({ areaName, commitSubjects, caseTitles });
    return this.tryTwice(base, (text): CoverageJudgment | undefined => {
      const json = extractFenced(text, ["json", ""]);
      if (!json) return undefined;
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return undefined;
      }
      const result = coverageSchema.safeParse(parsed);
      if (!result.success) return undefined;
      const rating = clamp(Math.round(result.data.rating), 0, 100);
      return { rating, suggestions: result.data.suggestions.slice(0, 5) };
    });
  }

  /**
   * Run a prompt, validate; on failure retry once with a corrective message.
   * `validate` returns `undefined` for unparseable/invalid output.
   */
  private async tryTwice<T>(
    prompt: string,
    validate: (text: string) => T | undefined,
  ): Promise<T | null> {
    const first = await this.complete(prompt);
    if (first) {
      const v = validate(first);
      if (v !== undefined) return v;
    }
    const corrective =
      `${prompt}\n\nYour previous response could not be parsed. ` +
      "Respond again with ONLY the requested content inside a single fenced code block.";
    const second = await this.complete(corrective);
    if (second) {
      const v = validate(second);
      if (v !== undefined) return v;
    }
    return null;
  }
}

/** Extract the first fenced code block matching one of the given languages. */
export function extractFenced(text: string, langs: string[]): string | null {
  for (const lang of langs) {
    const fence = lang ? `\`\`\`${lang}` : "```";
    const start = text.indexOf(fence);
    if (start === -1) continue;
    const afterFence = start + fence.length;
    const end = text.indexOf("```", afterFence);
    if (end === -1) continue;
    const body = text.slice(afterFence, end).replace(/^\r?\n/, "");
    if (body.trim().length > 0) return body;
  }
  return null;
}

function parseYamlSafe(text: string): unknown {
  try {
    return parseYaml(text);
  } catch {
    return undefined;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
