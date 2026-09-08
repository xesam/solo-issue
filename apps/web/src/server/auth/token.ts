import { randomBytes } from "crypto";
import { HttpError } from "@/lib/api";
import { MIN_MCP_VERSION, mcpClientOutdated } from "@/lib/api-contract";
import { BASE_PATH } from "@/lib/base-path";
import { prisma } from "@/lib/prisma";
import { API_SCOPES } from "@/lib/scopes";
import { hashToken } from "@/server/auth/hash";

// R3：API Token（Bearer）—— AI Agent / 外部集成的凭证体系
// 约定：
// - token 形如 itr_xxx，仅创建时可见；库里只存 SHA-256
// - scope = `<resource>:<read|write>`，或 "*"（全部）；**不含任何白名单资源段**的
//   路径一律 403（默认拒绝——注意不是"白名单外的路径"：/api/projects/** 下未登记的
//   子路径会按 projects 段推导，这是语义而非漏洞，views 即此例；唯一豁免见 SCOPE_EXEMPT_PATHS）
// - 认证/令牌管理/模拟/治理/个人视图通道是 Bearer 禁区（见 BEARER_FORBIDDEN）
// - 内存频控 120 次/分钟/令牌（单实例部署；多实例需换共享存储）

export const TOKEN_PREFIX = "itr_";

// 路径资源段白名单：scope 推导取「最后一个匹配段」
//   POST /api/projects/:id/issues/:n/comments → comments:write
//   GET  /api/projects/:id/issues              → issues:read
const RESOURCE_SEGMENTS = new Set([
  "workspaces",
  "projects",
  "issues",
  "states",
  "fields",
  "comments",
  "attachments",
  "activities",
  "search",
]);

// 子资源映射到所属母资源的 scope（对齐 AGENTS.md 的 scope 表）：
//   states/workspaces 随 projects:read（discover_context 需要）
//   attachments/activities 随 issues:read（activities:read 为预留 scope，当前未启用）
const SEGMENT_PARENT: Record<string, string> = {
  states: "projects",
  workspaces: "projects",
  attachments: "issues",
  activities: "issues",
};

// AGENTS.md 承诺的 Bearer 禁区显式列出（/api/workbench、/api/notifications 等
// 个人视图端点若只靠"资源段白名单外"的兜底机制落 403，将来 RESOURCE_SEGMENTS
// 扩段时承诺会静默失效——故必须进数组）。/api/admin 同理：治理台 session-only，
// 此前它靠 "users 段" 403、"workspaces 段碰巧映射 projects:read" 的不对称兜底，
// 持 projects:read 的令牌竟能拉全工作区列表——治理面必须整前缀硬关。
const BEARER_FORBIDDEN = [
  "/api/auth/",
  "/api/api-tokens",
  "/api/mock/",
  "/api/workbench",
  "/api/notifications",
  "/api/admin",
];

// 唯一的资源 scope 豁免：/api/meta（版本协商）是 solo-issue-mcp 启动自检的最小前提，
// 任何有效令牌可读——"路径无资源段默认拒绝"不适用于它，故显式列出而非改推导规则
const SCOPE_EXEMPT_PATHS = new Set(["/api/meta"]);

const RATE_LIMIT_PER_MIN = 120;

export function requiredScope(method: string, path: string): string | null {
  const segs = path.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const matched = segs.filter((s) => RESOURCE_SEGMENTS.has(s));
  if (!matched.length) return null;
  const last = matched[matched.length - 1];
  const action = method === "GET" || method === "HEAD" ? "read" : "write";
  // 推导出的 scope 若同时在 API_SCOPES 白名单外（当前仅 projects:write——项目
  // 治理/管理动作有意留给人类会话，AGENTS.md scope 表刻意不含它），持有者会得到
  // 403"缺少权限范围"而非 500——不可授予是"禁区拒绝"，不是服务器故障。
  // 往 RESOURCE_SEGMENTS 加段时须确认其 read/write 要么可授予要么有意为禁区，
  // 对账靠 verify-agent 的 scope 回归段（createApiToken 白名单会挡住令牌面）。
  return `${SEGMENT_PARENT[last] ?? last}:${action}`;
}

// api-tokens 路由的响应列（GET 列表与 POST 创建共用；刻意不含 tokenHash——哈希只入库不出库）
export const TOKEN_FIELDS = {
  id: true,
  name: true,
  scopes: true,
  lastUsedAt: true,
  expiresAt: true,
  createdAt: true,
};

export async function createApiToken(
  userId: string,
  input: { name: string; scopes: string[]; expiresInDays?: number | null },
) {
  for (const s of input.scopes) {
    // zod（createApiTokenSchema）已白名单化 scope；此循环是服务层自卫性第二闸，
    // 防未来新增调用点绕过路由校验直调本函数——请勿当作死代码删除
    if (!(API_SCOPES as readonly string[]).includes(s))
      throw new HttpError(422, "errors.unknownScope", undefined, { scope: s });
  }
  const token = TOKEN_PREFIX + randomBytes(24).toString("base64url");
  const record = await prisma.apiToken.create({
    data: {
      userId,
      name: input.name,
      scopes: input.scopes,
      tokenHash: hashToken(token),
      ...(input.expiresInDays
        ? { expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000) }
        : {}),
    },
    select: TOKEN_FIELDS,
  });
  return { token, record };
}

// ── 频控与 lastUsedAt 节流（进程内存，单实例足够）──
const rateMap = new Map<string, { windowStart: number; count: number }>();
const touchMap = new Map<string, number>();

function checkRateLimit(tokenId: string) {
  const now = Date.now();
  const entry = rateMap.get(tokenId);
  if (!entry || now - entry.windowStart > 60_000) {
    rateMap.set(tokenId, { windowStart: now, count: 1 });
    return;
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_PER_MIN) {
    // AGENTS.md 承诺 429 带 Retry-After，Agent 按 window 剩余秒数退避
    const retryAfter = Math.max(1, Math.ceil((entry.windowStart + 60_000 - now) / 1000));
    throw new HttpError(
      429,
      "errors.tokenTooFrequent",
      { "Retry-After": String(retryAfter) },
      { limit: RATE_LIMIT_PER_MIN },
    );
  }
}

async function touchLastUsed(tokenId: string) {
  const last = touchMap.get(tokenId) ?? 0;
  if (Date.now() - last > 60_000) {
    touchMap.set(tokenId, Date.now());
    await prisma.apiToken
      .update({ where: { id: tokenId }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }
}

/**
 * 校验 Bearer 请求。
 * 返回 null：没有 Authorization 头（调用方回落到会话鉴权）。
 * 返回用户；无权/无效时抛 HttpError（401/403/429）。
 */
export async function verifyApiTokenRequest(
  req: Request,
): Promise<{ userId: string } | null> {
  const auth = req.headers.get("authorization");
  // RFC 7235：scheme 大小写不敏感（curl/Apache 偶发发小写 bearer）
  if (!auth || !/^Bearer /i.test(auth)) return null;

  const url = new URL(req.url);
  // 部署在 basePath 下时，路由器透传的 req.url 恒带前缀（/solo-issue/api/...）。
  // 全部路径判定必须先剥前缀再比对——BEARER_FORBIDDEN / SCOPE_EXEMPT_PATHS 是
  // 逻辑路径，否则禁区与豁免在部署态静默失配（meta 误 403、禁区误放行）。
  // requiredScope 对前缀碰巧免疫（"solo-issue" 不在资源段白名单），但同样统一收窄。
  const pathname = url.pathname.startsWith(BASE_PATH)
    ? url.pathname.slice(BASE_PATH.length) || "/"
    : url.pathname;
  if (BEARER_FORBIDDEN.some((p) => pathname.startsWith(p))) {
    throw new HttpError(403, "errors.bearerForbidden");
  }

  const token = auth.slice(7).trim();
  if (!token.startsWith(TOKEN_PREFIX)) throw new HttpError(401, "errors.tokenInvalidFormat");

  // 426 版本闸（docs/11-mcp-adapter.md §5.2）：只治理自家分发的 mcp 包（X-Client 头），
  // 位置在查库之前——旧包立即得到"升级"这一最可行动作，不为注定 426 的请求付 DB 往返；
  // 无头/异头请求不经过此处，脚本与自建 Agent 零影响
  if (mcpClientOutdated(req.headers.get("x-client")))
    throw new HttpError(426, "errors.mcpUpgradeRequired", undefined, { min: MIN_MCP_VERSION });

  const row = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, isActive: true } } },
  });
  if (!row) throw new HttpError(401, "errors.tokenInvalidOrRevoked");
  if (row.expiresAt && row.expiresAt < new Date())
    throw new HttpError(401, "errors.tokenExpired");
  if (!row.user.isActive) throw new HttpError(401, "errors.tokenOwnerDisabled");

  checkRateLimit(row.id);

  const need = requiredScope(req.method, pathname);
  if (need) {
    const hasScope = row.scopes.includes("*") || row.scopes.includes(need);
    if (!hasScope) throw new HttpError(403, "errors.missingScope", undefined, { scope: need });
  } else if (!SCOPE_EXEMPT_PATHS.has(pathname)) {
    throw new HttpError(403, "errors.tokenResourceForbidden");
  }

  await touchLastUsed(row.id);
  return { userId: row.user.id };
}
