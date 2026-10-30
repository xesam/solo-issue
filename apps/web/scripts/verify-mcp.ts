/**
 * M4 契约矩阵：MCP 包（packages/mcp）× 部署服务 REST 契约的端到端验收（docs/11-mcp-adapter.md §7.1）。
 * 前置：服务已起（pnpm build && pnpm start，或 pnpm dev）；node_modules 就绪——脚本自构建 mcp dist
 * 运行：pnpm tsx scripts/verify-mcp.ts（BASE_URL 可选传「服务根」，basePath 自动追加——同 verify-agent）
 * 链路：REST 造会话/令牌 → stdio 起真 MCP 服务（initialize 即消费 /api/meta 软闸）→
 *       启动负例（401/网络不可达）→ 全工具正向矩阵（写路径落通知断言）→
 *       工具负例（403/404/422/429）→ 426 版本闸（REST 直打，双闸对照）
 * 自清理：演示 issue 直连 Prisma 硬删 + 三枚 API 令牌撤销；中断残留由 preClean 幂等清扫（同 verify-agent 口径）
 */
import "dotenv/config"; // BASE_PATH 等部署配置与被测服务同源（与 verify-agent 对齐——自定义前缀下验收不迷路）
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BASE_PATH } from "../src/lib/base-path";
import { check, finish } from "./lib/verify-kit";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const ROOT = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? "8081"}`;
const BASE = ROOT.endsWith(BASE_PATH) ? ROOT : `${ROOT}${BASE_PATH}`;
// 空串与未设同罪（verify-all 显式 export；本地直跑回落种子口径）
const DEMO_PROJECT = process.env.DEMO_PROJECT?.trim() || "demo";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "solo-issue@github.com").trim().toLowerCase();
// scripts 位于 apps/web/scripts/：三层才回到仓库根（packages 与 apps 平级）
const DIST = fileURLToPath(new URL("../../../packages/mcp/dist/index.js", import.meta.url));

async function api(
  method: string,
  path: string,
  opts: { token?: string; cookie?: string; body?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, raw: text };
}

async function devLogin(email: string) {
  const res = await fetch(`${BASE}/api/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie)
    throw new Error(`dev-login(${email}) 未发放会话（HTTP ${res.status}）：检查 ALLOW_DEV_LOGIN 与账号`);
  return setCookie.split(";")[0];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 子进程 env：NodeJS ProcessEnv 含 undefined 值，StdioClientTransport 只收 Record<string, string>
const childEnv = (extra: Record<string, string>): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return { ...env, ...extra };
};

// ── MCP 侧设施 ──
async function spawnMcp(token: string) {
  const client = new Client({ name: "verify-mcp", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [DIST],
    env: childEnv({ SOLO_ISSUE_URL: BASE, SOLO_ISSUE_TOKEN: token }),
    stderr: "pipe",
  });
  let errBuf = "";
  transport.stderr?.on("data", (d: Buffer) => {
    errBuf += d.toString();
  });
  await client.connect(transport);
  return { client, stderr: () => errBuf };
}

/** 启动负例：-connect 必须拒绝，且 stderr 问题说明含预期指引文本（fast-fail 的可读性即验收项） */
async function expectStartupFail(
  env: Record<string, string>,
  expectText: string,
  label: string,
) {
  const client = new Client({ name: "verify-mcp", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [DIST],
    env: childEnv(env),
    stderr: "pipe",
  });
  let errBuf = "";
  transport.stderr?.on("data", (d: Buffer) => {
    errBuf += d.toString();
  });
  let rejected = false;
  try {
    await client.connect(transport);
  } catch {
    rejected = true;
  }
  await sleep(200);
  check(label, rejected && errBuf.includes(expectText), `(${errBuf.trim().slice(0, 70)}…)`);
}

type ToolResult = { isError: boolean; text: string; data: any };

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  // 联合返回类型收窄为验收所需子集（content 文本块 + isError）
  const r = (await client.callTool({ name, arguments: args })) as {
    content?: { type?: string; text?: string }[];
    isError?: boolean;
  };
  const block = r.content?.[0];
  const text = block?.type === "text" ? block.text ?? "" : "";
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  return { isError: r.isError === true, text, data };
}

const safeClose = (c: Client) => c.close().catch(() => {});

// ── preClean：中断残留幂等清扫（issue 按 title 前缀；级联带走通知/活动/评论）──
async function preClean() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const issues = await prisma.issue.deleteMany({ where: { title: { startsWith: "[mcp-verify]" } } });
    if (issues.count) console.log(`已预清上轮中断残留：issue × ${issues.count}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function cleanup(issueId: string | undefined): Promise<boolean> {
  if (!issueId) return true;
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      await prisma.issue.delete({ where: { id: issueId } });
      console.log("已清理本轮演示 issue（自删除）");
      return true;
    } finally {
      await prisma.$disconnect();
    }
  } catch (e) {
    console.error("收尾自清理失败（残留请跑 scripts/ops-cleanup.ts）：", e);
    return false;
  }
}

async function main() {
  console.log("\n━━ M4 MCP 契约矩阵验收 ━━\n");

  console.log("[0] 构建 MCP dist（契约矩阵以当前源码为准）");
  try {
    execSync("pnpm --filter solo-issue-mcp build", { cwd: ROOT_DIR, stdio: "pipe" });
    check("solo-issue-mcp 构建成功", true);
  } catch (e) {
    check("solo-issue-mcp 构建成功", false, String((e as Error).message).slice(0, 80));
  }
  await preClean();

  // ── 1. 会话与令牌 ──
  const admin = await devLogin(ADMIN_EMAIL);
  const wangwu = await devLogin("wangwu@example.com");
  const preflight = await api("GET", "/api/auth/me", { cookie: admin });
  if (preflight.status === 403) {
    console.error(`管理员处于强制改密状态：请先完成改密再运行本脚本`);
    process.exit(1);
  }

  const mint = async (name: string, scopes: string[]) => {
    const r = await api("POST", "/api/api-tokens", { cookie: admin, body: { name, scopes, expiresInDays: 1 } });
    if (r.status !== 201) throw new Error(`签发 ${name} 失败：HTTP ${r.status}`);
    return { token: r.json.data.token as string, id: r.json.data.id as string };
  };

  console.log("[1] 签发矩阵令牌（full / 只读 / 频控专用）");
  const FULL = await mint("mcp-verify", ["*"]);
  const RO = await mint("mcp-verify-ro", ["projects:read", "fields:read", "issues:read", "comments:read", "search:read"]);
  const HAMMER = await mint("mcp-verify-hammer", ["projects:read"]);
  check("三枚令牌就绪", true);

  // ── 2. 启动负例（软闸的 fast-fail 在第一次会话前截断）──
  console.log("\n[2] 启动自检负例");
  await expectStartupFail({ SOLO_ISSUE_URL: BASE, SOLO_ISSUE_TOKEN: "itr_invalid" }, "重新签发", "坏令牌 → 启动拒绝并提示重新签发");
  await expectStartupFail({ SOLO_ISSUE_URL: "http://127.0.0.1:1/solo-issue", SOLO_ISSUE_TOKEN: FULL.token }, "无法连接", "URL 不可达 → 启动拒绝并提示检查 SOLO_ISSUE_URL");

  // ── 3. 正向矩阵：全工具 ──
  console.log("\n[3] 正向矩阵（full 令牌）");
  const m = await spawnMcp(FULL.token);
  const version = m.client.getServerVersion();
  check("initialize 通过（/api/meta 软闸）且 serverInfo=0.0.2", version?.version === "0.0.2");

  const { tools } = await m.client.listTools();
  const names = tools.map((t) => t.name).sort();
  check(
    "listTools 13/13（与 docs/11-mcp-adapter.md §3.1 同源）",
    JSON.stringify(names) ===
      JSON.stringify(
        ["add_comment", "create_issue", "get_fields_schema", "list_issues", "list_members", "list_projects", "list_states", "list_workspaces", "read_history", "read_issue", "search_everything", "update_issue", "whoami"],
      ),
  );

  const me = await callTool(m.client, "whoami", {});
  check("whoami 回显令牌归属用户与工作区",
    !me.isError && !!me.data?.user?.id && Array.isArray(me.data?.workspaces));
  const wss = await callTool(m.client, "list_workspaces", {});
  const wssRow = wss.data?.[0] ?? (wss.data?.data ?? [])[0];
  const WS = wssRow?.slug;
  check("list_workspaces 列出工作区（wsSlug 来源）", !wss.isError && typeof WS === "string", `(首个: ${WS})`);

  const projects = await callTool(m.client, "list_projects", { wsSlug: WS });
  const project = (projects.data?.data ?? projects.data ?? []).find((p: any) => p.slug === DEMO_PROJECT);
  check("list_projects 命中演示项目", !projects.isError && !!project, `(${project?.name})`);
  if (!project?.id) {
    console.error(`未找到演示项目（slug=${DEMO_PROJECT}）：先跑 pnpm verify:seed（或 pnpm db:seed），或用 DEMO_PROJECT 指定`);
    finish("verify-mcp");
  }
  const PID = project.id;

  const states = await callTool(m.client, "list_states", { projectId: PID });
  const todo = (states.data?.data ?? states.data ?? []).find((s: any) => s.isDefault);
  check("list_states 含默认状态", !states.isError && !!todo);

  const members = await callTool(m.client, "list_members", { wsSlug: WS });
  const ww = (members.data?.data ?? members.data ?? []).find((mm: any) => mm.user?.email === "wangwu@example.com");
  check("list_members 命中王五", !members.isError && !!ww);

  const schema = await callTool(m.client, "get_fields_schema", { projectId: PID });
  check("get_fields_schema 自描述（$schema + additionalProperties=false）",
    !schema.isError && schema.data?.$schema !== undefined && schema.data?.additionalProperties === false);

  // ── 4. 写路径 + 通知基线 ──
  console.log("\n[4] 写路径（创建/更新/评论 @提及）");
  const unreadBefore = ((await api("GET", "/api/notifications", { cookie: wangwu })).json?.data?.unreadCount ?? 0) as number;
  const created = await callTool(m.client, "create_issue", {
    projectId: PID,
    title: "[mcp-verify] MCP 契约矩阵巡检",
    descriptionText: "M4 验收：本 issue 由 verify-mcp 经工具面创建，随脚本自清理。",
    assigneeIds: [ww.user.id],
    stateId: todo.id,
  });
  check("create_issue 201", !created.isError && typeof created.data?.number === "number", `(${DEMO_PROJECT.toUpperCase()}-${created.data?.number})`);
  const num = created.data?.number;
  const issueId = created.data?.id;
  const ref = `${DEMO_PROJECT.toUpperCase()}-${num}`;

  const updated = await callTool(m.client, "update_issue", {
    projectId: PID,
    number: num,
    title: "[mcp-verify] MCP 契约矩阵巡检（已升级）",
  });
  check("update_issue 部分更新生效", !updated.isError && String(updated.data?.title).includes("已升级"));

  const commented = await callTool(m.client, "add_comment", {
    projectId: PID,
    number: num,
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "契约矩阵已完成，请 " },
            { type: "mention", attrs: { id: ww.user.id, label: ww.user.name } },
            { type: "text", text: " 复核。" },
          ],
        },
      ],
    },
  });
  check("add_comment（含 @提及）", !commented.isError);

  const detail = await callTool(m.client, "read_issue", { projectId: PID, number: num });
  check("read_issue 详情可读（含 fieldValues）", !detail.isError && typeof detail.data?.fieldValues === "object");

  const history = await callTool(m.client, "read_history", { projectId: PID, number: num });
  const kinds = (history.data?.data ?? history.data ?? []).map((a: any) => a.action);
  check("read_history 活动含 CREATED/ASSIGNED/UPDATED/COMMENTED",
    !history.isError && ["CREATED", "ASSIGNED", "UPDATED", "COMMENTED"].every((k) => kinds.includes(k)),
    `(${kinds.join(",")})`);

  const listed = await callTool(m.client, "list_issues", { projectId: PID, q: "MCP 契约矩阵" });
  check("list_issues 关键词过滤命中本轮 issue",
    !listed.isError && (listed.data?.issues ?? []).some((i: any) => i.number === num));

  const searched = await callTool(m.client, "search_everything", { q: "MCP 契约矩阵" });
  const hit = (searched.data?.issues ?? []).some((i: any) => i.number === num && i.project?.slug === DEMO_PROJECT);
  check("search_everything 全局命中且带深链",
    !searched.isError && hit && (searched.data?.issues ?? []).every((i: any) => i.url?.startsWith("/w/")));

  // ── 5. 通知回路（经 MCP 写路径产生）──
  console.log("\n[5] 通知回路");
  const notif = await api("GET", "/api/notifications", { cookie: wangwu });
  // 通知 title 只承载 issue ref（DEMO-xx），过滤用 ref 而非标题前缀（同 verify-agent 口径）
  const thisRef = (notif.json?.data?.notifications ?? []).filter((n: any) => String(n.title).includes(ref));
  check("王五收到指派通知", thisRef.some((n: any) => n.type === "ASSIGNED"), `(ref=${ref})`);
  check("王五收到提及通知（type=MENTIONED）", thisRef.some((n: any) => n.type === "MENTIONED"), `(ref=${ref})`);
  const unread = notif.json?.data?.unreadCount;
  check("未读计数按本轮增量增加", typeof unread === "number" && unread >= unreadBefore + 2, `(unread=${unread}, before=${unreadBefore})`);

  // ── 6. 工具负例矩阵 ──
  console.log("\n[6] 工具负例（403/422/404/429 全走错误转译）");
  const ro = await spawnMcp(RO.token);
  const roWrite = await callTool(ro.client, "create_issue", { projectId: PID, title: "越权尝试" });
  check("只读令牌 create_issue → isError [HTTP 403]", roWrite.isError && roWrite.text.includes("[HTTP 403]"), `(${roWrite.text.slice(0, 60)}…)`);
  const roRead = await callTool(ro.client, "search_everything", { q: "MCP 契约矩阵" });
  check("只读令牌 search_everything 正常（对照组 200）", !roRead.isError);
  await safeClose(ro.client);

  const ghost = await callTool(m.client, "create_issue", {
    projectId: PID,
    title: "x",
    fieldValues: { __mcp_verify_ghost: "非法字段" },
  });
  check("未知字段 key → isError [HTTP 422]（字段明细透传）", ghost.isError && ghost.text.includes("[HTTP 422]"), `(${ghost.text.slice(0, 60)}…)`);

  const nf = await callTool(m.client, "read_issue", { projectId: PID, number: 999999999 });
  check("不存在 → isError [HTTP 404]", nf.isError && nf.text.includes("[HTTP 404]"));

  const noSlug = await callTool(m.client, "list_projects", {});
  check("list_projects 缺 wsSlug → 客户端 schema 校验拒绝（非 HTTP 错误）",
    noSlug.isError && !noSlug.text.includes("[HTTP"),
    `(${noSlug.text.slice(0, 60)}…)`);

  // 429：先起 MCP（自检先行），再经 REST 灌满频控窗口，随后工具调用必须撞 429
  const ham = await spawnMcp(HAMMER.token);
  let saw429 = false;
  for (let i = 0; i < 121; i++) {
    const r = await api("GET", "/api/meta", { token: HAMMER.token });
    if (r.status === 429) {
      saw429 = true;
      break;
    }
  }
  check("REST 侧灌满频控窗口（121 次内出现 429）", saw429);
  const jammed = await callTool(ham.client, "whoami", {});
  check("频控后工具调用 → isError [HTTP 429] + Retry-After（豁免端点同样计频控）",
    jammed.isError && jammed.text.includes("[HTTP 429]") && jammed.text.includes("Retry-After"),
    `(${jammed.text.slice(0, 60)}…)`);
  await safeClose(ham.client);
  await safeClose(m.client);

  // ── 7. 426 版本闸（REST 直打，双闸对照——MCP 包自身恒发 0.0.2 不越狱）──
  console.log("\n[7] 426 版本闸对照");
  const outdated = await fetch(`${BASE}/api/search?q=x`, {
    headers: { authorization: `Bearer ${FULL.token}`, "x-client": "solo-issue-mcp/0.0.0" },
  });
  check("过旧 X-Client → 426（消息含升级目标）", outdated.status === 426 && (await outdated.text()).includes("0.0.1"));
  const current = await fetch(`${BASE}/api/search?q=x`, {
    headers: { authorization: `Bearer ${FULL.token}`, "x-client": "solo-issue-mcp/0.0.1" },
  });
  check("当前版 X-Client → 200（对照）", current.status === 200);

  // ── 8. 收尾：令牌撤销 + 自清理 ──
  console.log("\n[8] 令牌生命周期与自清理");
  let revoked = 0;
  for (const t of [FULL, RO, HAMMER]) {
    const del = await api("DELETE", `/api/api-tokens/${t.id}`, { cookie: admin });
    if (del.status === 200) revoked += 1;
  }
  check("三枚令牌撤销", revoked === 3);
  const afterRevoke = await api("GET", "/api/me", { token: FULL.token });
  check("撤销后旧令牌 → 401（scope 豁免不豁免凭证有效性）", afterRevoke.status === 401);

  const cleaned = await cleanup(issueId);
  check("收尾自清理完成（本轮 issue）", cleaned);

  finish("verify-mcp");
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(1);
});

export {};
