import { describe, expect, it, vi } from "vitest";
import { CredentialError } from "../../src/errors.js";
import { TestinyClient } from "../../src/testiny/client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("TestinyClient", () => {
  it("requires an API key", () => {
    expect(() => new TestinyClient({ apiKey: "" })).toThrow(CredentialError);
  });

  it("paginates fully across multiple pages", async () => {
    // 5 cases, page size 2 -> 3 requests (2, 2, 1).
    const all = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, title: `Case ${i + 1}` }));
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { offset: number; limit: number };
      const page = all.slice(body.offset, body.offset + body.limit);
      return jsonResponse({ meta: { count: all.length, offset: body.offset, limit: body.limit }, data: page });
    }) as unknown as typeof fetch;

    const client = new TestinyClient({ apiKey: "k", fetchImpl, pageSize: 2 });
    const cases = await client.listCasesInFolder(1, 10);

    expect(cases).toHaveLength(5);
    expect(cases.map((c) => c.id)).toEqual([1, 2, 3, 4, 5]);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(3);
  });

  it("maps timestamp and folder fields from wire names", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        meta: { count: 1, offset: 0, limit: 100 },
        data: [
          {
            id: 7,
            title: "Refund",
            text_description: "desc",
            testcase_folder_id: 3,
            created_at: "2026-01-01T00:00:00Z",
            modified_at: "2026-06-01T00:00:00Z",
          },
        ],
      }),
    ) as unknown as typeof fetch;
    const client = new TestinyClient({ apiKey: "k", fetchImpl });
    const [c] = await client.listCasesInFolder(1, 3);
    expect(c).toMatchObject({
      id: 7,
      title: "Refund",
      description: "desc",
      folderId: 3,
      createdAt: "2026-01-01T00:00:00Z",
      modifiedAt: "2026-06-01T00:00:00Z",
    });
  });

  it("throws CredentialError on 401", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "nope" }, 401)) as unknown as typeof fetch;
    const client = new TestinyClient({ apiKey: "bad", fetchImpl });
    await expect(client.listProjects()).rejects.toBeInstanceOf(CredentialError);
  });

  it("retries once on 500 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ error: "boom" }, 500);
      return jsonResponse({ meta: { count: 0, offset: 0, limit: 100 }, data: [] });
    }) as unknown as typeof fetch;
    const client = new TestinyClient({ apiKey: "k", fetchImpl, sleep: async () => {} });
    const projects = await client.listProjects();
    expect(projects).toEqual([]);
    expect(calls).toBe(2);
  });
});
