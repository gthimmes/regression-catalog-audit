/**
 * All Claude prompts live here as exported template functions (SPEC). Unit tests
 * assert the key inputs are interpolated.
 */

/** System prompt shared by both AI features — read-only, YAML/JSON-only outputs. */
export const SYSTEM_PROMPT =
  "You are a release-engineering assistant that helps keep Testiny regression " +
  "catalogs aligned with code activity. Be precise and terse. When asked for " +
  "YAML or JSON, respond with ONLY that content inside a single fenced code block.";

export interface MappingPromptInput {
  unmappedPaths: string[];
  folders: string[];
}

/** Ask Claude to propose `areas` YAML entries for unmapped high-churn paths. */
export function mappingSuggestionPrompt(input: MappingPromptInput): string {
  const paths = input.unmappedPaths.map((p) => `- ${p}`).join("\n");
  const folders = input.folders.map((f) => `- ${f}`).join("\n");
  return [
    "The following high-churn code paths are not mapped to any regression catalog area:",
    paths || "- (none)",
    "",
    "Available Testiny folders that could hold regression cases for these paths:",
    folders || "- (none)",
    "",
    "Propose new `areas` entries mapping these paths to appropriate folders.",
    "Respond with YAML only, inside one fenced code block, shaped exactly like:",
    "```yaml",
    "areas:",
    "  - name: <kebab-case-name>",
    "    team: <team>",
    "    paths:",
    '      - "<glob>"',
    "    testiny:",
    "      folder: <folder-name>",
    "```",
    "Only use folders from the list above. Do not include commentary.",
  ].join("\n");
}

export interface CoveragePromptInput {
  areaName: string;
  commitSubjects: string[];
  caseTitles: string[];
}

/** Ask Claude to rate plausible coverage and suggest regression case titles. */
export function coverageJudgmentPrompt(input: CoveragePromptInput): string {
  const subjects = input.commitSubjects.map((s) => `- ${s}`).join("\n");
  const titles = input.caseTitles.map((t) => `- ${t}`).join("\n");
  return [
    `Area "${input.areaName}" was recently changed. Recent commit subjects:`,
    subjects || "- (none)",
    "",
    "Existing mapped regression test case titles:",
    titles || "- (none)",
    "",
    "Assess how plausibly the existing test cases cover the recent changes.",
    "Respond with JSON only, inside one fenced code block, shaped exactly like:",
    "```json",
    '{ "rating": <0-100 integer>, "suggestions": ["<title>", "..."] }',
    "```",
    "`rating` is your confidence the changes are covered (0 = not at all, 100 = fully).",
    "`suggestions` lists up to 5 regression case titles that would close gaps.",
  ].join("\n");
}
