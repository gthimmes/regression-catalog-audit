import { describe, expect, it, vi } from "vitest";
import { AiClient, extractFenced } from "../../src/ai/client.js";
import { CredentialError } from "../../src/errors.js";

function textResponse(text: string): Response {
  return new Response(JSON.stringify({ content: [{ type: "text", text }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function queueFetch(responses: Response[]): typeof fetch {
  let i = 0;
  return vi.fn(async () => responses[Math.min(i++, responses.length - 1)]) as unknown as typeof fetch;
}

describe("extractFenced", () => {
  it("pulls the body of a fenced block", () => {
    expect(extractFenced("```json\n{\"a\":1}\n```", ["json"])).toBe('{"a":1}\n');
  });
  it("returns null when no matching fence exists", () => {
    expect(extractFenced("no fence here", ["json"])).toBeNull();
  });
});

describe("AiClient", () => {
  it("requires an API key", () => {
    expect(() => new AiClient({ apiKey: "" })).toThrow(CredentialError);
  });

  it("suggestMappings returns validated YAML", async () => {
    const yaml = [
      "```yaml",
      "areas:",
      "  - name: billing",
      "    team: Ledger",
      "    paths:",
      '      - "apps/billing/**"',
      "    testiny:",
      "      folder: Billing",
      "```",
    ].join("\n");
    const client = new AiClient({ apiKey: "k", fetchImpl: queueFetch([textResponse(yaml)]) });
    const result = await client.suggestMappings(["apps/billing/x.ts"], ["Billing"]);
    expect(result).toContain("name: billing");
  });

  it("suggestMappings degrades to null when output never validates", async () => {
    const bad = textResponse("here are some thoughts, no yaml block");
    const client = new AiClient({ apiKey: "k", fetchImpl: queueFetch([bad, bad]) });
    const result = await client.suggestMappings(["apps/billing/x.ts"], ["Billing"]);
    expect(result).toBeNull();
  });

  it("suggestMappings rejects schema-invalid YAML (re-validation)", async () => {
    const invalid = textResponse("```yaml\nareas:\n  - name: x\n```"); // missing team/paths/testiny
    const client = new AiClient({ apiKey: "k", fetchImpl: queueFetch([invalid, invalid]) });
    expect(await client.suggestMappings(["p"], ["F"])).toBeNull();
  });

  it("judgeCoverage parses and clamps the rating", async () => {
    const res = textResponse('```json\n{ "rating": 140, "suggestions": ["Add refund edge-case test"] }\n```');
    const client = new AiClient({ apiKey: "k", fetchImpl: queueFetch([res]) });
    const j = await client.judgeCoverage("payments", ["Fix"], ["Happy path"]);
    expect(j?.rating).toBe(100);
    expect(j?.suggestions).toEqual(["Add refund edge-case test"]);
  });

  it("judgeCoverage retries once then succeeds", async () => {
    const bad = textResponse("no json");
    const good = textResponse('```json\n{ "rating": 42, "suggestions": [] }\n```');
    const client = new AiClient({ apiKey: "k", fetchImpl: queueFetch([bad, good]) });
    const j = await client.judgeCoverage("payments", [], []);
    expect(j?.rating).toBe(42);
  });
});
