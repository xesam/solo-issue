import type { McpConfig } from "./config.js";
import { X_CLIENT } from "./contract.js";
import { ApiHttpError } from "./errors.js";

// REST 客户端：Bearer + X-Client（版本协商头）+ {data}/{error} 剥壳。
// 纯透传纪律：不缓存、不改写、不吞错——错误语义单源在服务端。

type QueryValue = string | number | boolean | undefined;

type RestOptions = {
  query?: Record<string, QueryValue>;
  body?: unknown;
};

export class ApiClient {
  constructor(
    private readonly cfg: McpConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get<T = unknown>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { body });
  }

  async request<T = unknown>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    opts: RestOptions = {},
  ): Promise<T> {
    const search =
      opts.query !== undefined ? new URLSearchParams(buildEntries(opts.query)) : "";
    const url = `${this.cfg.baseUrl}${path}${search ? `?${search}` : ""}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${this.cfg.token}`,
        "x-client": X_CLIENT,
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        json && typeof json === "object" && "error" in json
          ? String((json as { error: unknown }).error)
          : res.statusText || `HTTP ${res.status}`;
      throw new ApiHttpError(res.status, message, res.headers.get("retry-after") ?? undefined);
    }
    return ((json as { data?: T } | null)?.data ?? null) as T;
  }
}

function buildEntries(query: Record<string, QueryValue>): [string, string][] {
  const entries: [string, string][] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === "") continue;
    entries.push([k, String(v)]);
  }
  return entries;
}

/** 自定义字段过滤（cf.<key>=<value>）与固定参数合流——多选为包含语义、仅 SELECT 可检索（AGENTS.md search_everything） */
export function withFieldFilters(
  filters: Record<string, string> | undefined,
  base: Record<string, QueryValue> = {},
): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = { ...base };
  for (const [k, v] of Object.entries(filters ?? {})) out[`cf.${k}`] = v;
  return out;
}
