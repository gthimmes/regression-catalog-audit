import { CredentialError, RuntimeError } from "../errors.js";

/**
 * Single, centralized Testiny REST client (SPEC: all Testiny access goes through
 * here; read-only in v1). Typed responses, full pagination, one retry with
 * backoff on 429/5xx.
 *
 * Endpoint shapes are per https://www.testiny.io/docs/rest-api/ :
 *   - Base URL:  https://app.testiny.io/api/v1
 *   - Auth:      X-Api-Key header
 *   - Find:      POST /{entity}/find  with a DataReadParams body
 *   - Response:  { meta: { count, offset, limit }, data: [...] }
 * Field names are kept in one place (this module) so they can be adjusted
 * against a live GET without touching the rest of the tool.
 */

export const DEFAULT_TESTINY_BASE_URL = "https://app.testiny.io/api/v1";

export interface TestinyProject {
  id: number;
  name: string;
}

export interface TestinyFolder {
  id: number;
  name: string;
  parentId: number | null;
  projectId: number;
}

export interface TestinyCase {
  id: number;
  title: string;
  description: string | null;
  folderId: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
  tags: string[];
}

/** Raw find response shape. */
interface FindResponse<T> {
  meta?: { count?: number; offset?: number; limit?: number };
  data?: T[];
}

export interface TestinyClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Page size for pagination. */
  pageSize?: number;
  /** Sleep function (injectable so tests don't actually wait on backoff). */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_PAGE_SIZE = 100;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TestinyClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pageSize: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: TestinyClientOptions) {
    if (!opts.apiKey) {
      throw new CredentialError("TESTINY_API_KEY is required");
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_TESTINY_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /** POST /{entity}/find, fully paginated; returns all rows. */
  private async findAll<T>(entity: string, filter: Record<string, unknown>): Promise<T[]> {
    const url = `${this.baseUrl}/${entity}/find`;
    const rows: T[] = [];
    let offset = 0;

    for (;;) {
      const body = JSON.stringify({ filter, offset, limit: this.pageSize });
      const res = await this.requestWithRetry(url, body);

      let payload: FindResponse<T>;
      try {
        payload = (await res.json()) as FindResponse<T>;
      } catch (err) {
        throw new RuntimeError(`Testiny returned invalid JSON for ${entity}/find`, {
          cause: err,
        });
      }

      const page = payload.data ?? [];
      rows.push(...page);

      const count = payload.meta?.count;
      const nextOffset = offset + page.length;
      // Stop when the page was short, empty, or we've collected the reported total.
      if (page.length === 0 || page.length < this.pageSize) break;
      if (typeof count === "number" && nextOffset >= count) break;
      offset = nextOffset;
    }
    return rows;
  }

  /** One retry with exponential backoff on 429/5xx; throws on other errors. */
  private async requestWithRetry(url: string, body: string): Promise<Response> {
    const maxAttempts = 2;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            "X-Api-Key": this.apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body,
        });
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts) {
          await this.sleep(250 * attempt);
          continue;
        }
        throw new RuntimeError(`Network error calling Testiny (${url})`, { cause: err });
      }

      if (res.status === 401 || res.status === 403) {
        throw new CredentialError(
          `Testiny rejected the API key (HTTP ${res.status}). Check TESTINY_API_KEY.`,
        );
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < maxAttempts) {
        await this.sleep(250 * attempt);
        continue;
      }

      if (!res.ok) {
        const text = await safeText(res);
        throw new RuntimeError(
          `Testiny request failed: HTTP ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
        );
      }
      return res;
    }

    throw new RuntimeError(`Testiny request failed after retries (${url})`, {
      cause: lastError,
    });
  }

  async listProjects(): Promise<TestinyProject[]> {
    const rows = await this.findAll<RawProject>("project", {});
    return rows.map(mapProject);
  }

  async listFolders(projectId: number): Promise<TestinyFolder[]> {
    const rows = await this.findAll<RawFolder>("testcase_folder", {
      project_id: projectId,
    });
    return rows.map((r) => mapFolder(r, projectId));
  }

  async listCasesInFolder(projectId: number, folderId: number): Promise<TestinyCase[]> {
    const rows = await this.findAll<RawCase>("testcase", {
      project_id: projectId,
      testcase_folder_id: folderId,
    });
    return rows.map(mapCase);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 300);
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ *
 * Field mapping. Keeping these adapters here means the rest of the code
 * depends only on our normalized shapes, not on Testiny's wire names.
 * ------------------------------------------------------------------ */

interface RawProject {
  id: number;
  name?: string;
}
interface RawFolder {
  id: number;
  name?: string;
  parent_id?: number | null;
  project_id?: number;
}
interface RawCase {
  id: number;
  title?: string;
  text_description?: string | null;
  description?: string | null;
  precondition_text?: string | null;
  testcase_folder_id?: number | null;
  created_at?: string | null;
  modified_at?: string | null;
  updated_at?: string | null;
  tags?: unknown;
}

function mapProject(r: RawProject): TestinyProject {
  return { id: r.id, name: r.name ?? String(r.id) };
}

function mapFolder(r: RawFolder, projectId: number): TestinyFolder {
  return {
    id: r.id,
    name: r.name ?? "",
    parentId: r.parent_id ?? null,
    projectId: r.project_id ?? projectId,
  };
}

function mapCase(r: RawCase): TestinyCase {
  const description = r.text_description ?? r.description ?? r.precondition_text ?? null;
  return {
    id: r.id,
    title: r.title ?? "",
    description,
    folderId: r.testcase_folder_id ?? null,
    createdAt: r.created_at ?? null,
    modifiedAt: r.modified_at ?? r.updated_at ?? null,
    tags: normalizeTags(r.tags),
  };
}

function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags
      .map((t) => (typeof t === "string" ? t : typeof t === "object" && t && "name" in t ? String((t as { name: unknown }).name) : ""))
      .filter((t): t is string => t.length > 0);
  }
  return [];
}
