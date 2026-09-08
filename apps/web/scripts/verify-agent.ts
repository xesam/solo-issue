/**
 * R3 Agent 接入面 · 端到端验收脚本（demo agent）
 * 运行前置：pnpm build && pnpm start（或 pnpm dev），服务默认在 localhost:8081（.env 的 PORT）
 * 运行：pnpm tsx scripts/verify-agent.ts
 * BASE_URL（可选）传「服务根」即可——部署 basePath（默认 /solo-issue，随 BASE_PATH）会自动追加，重复前缀自动去重
 *
 * 本脚本同时是「如何以 Agent 身份使用本系统」的活样例，
 * 与根目录 AGENTS.md「Agent API 接入」段配套阅读。
 */

import "dotenv/config";
import { BASE_PATH } from "../src/lib/base-path";
import { check, finish } from "./lib/verify-kit";

const ROOT = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? "8081"}`;
const BASE = ROOT.endsWith(BASE_PATH) ? ROOT : `${ROOT}${BASE_PATH}`;
const DEMO_PROJECT = process.env.DEMO_PROJECT ?? "demo";

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
  // fail-fast 人话归因：4xx 时无 set-cookie，裸 .split 只会炸出难归因的 TypeError
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie)
    throw new Error(
      `dev-login(${email}) 未发放会话（HTTP ${res.status}）：检查 ALLOW_DEV_LOGIN 是否开启、该邮箱是否为已建账号`,
    );
  return setCookie.split(";")[0];
}

// 管理员登录键与 prisma/seed 同口径参数化——本地库常用 ADMIN_EMAIL 定制，硬编码占位会 401
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "solo-issue@github.com").trim().toLowerCase();

// 起跑预清（幂等）：上轮被中断（Ctrl-C / 进程被杀）时收尾自删不会执行，
// 固定 key 的残留字段会让本轮 POST /fields 撞 409 直接红——先清后跑
async function preClean() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const fields = await prisma.customField.deleteMany({ where: { key: "agent_demo_sev" } });
    const issues = await prisma.issue.deleteMany({
      where: { title: { startsWith: "[agent-demo]" } },
    });
    if (fields.count || issues.count)
      console.log(`已预清上轮中断残留：字段 × ${fields.count}、issue × ${issues.count}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  console.log("\n━━ R3 Agent 接入面验收 ━━\n");
  await preClean();

  // ── 0. 会话准备（管理员发令牌；王五做被通知人）──
  const admin = await devLogin(ADMIN_EMAIL);
  const wangwu = await devLogin("wangwu@example.com");
  // 会话闸前置：强制改密状态的会话被业务 API 挡 403（护栏如此设计），
  // 先失败给出人话，别让 20 个检查项以同一种 403 集体红掉
  const preflight = await api("GET", "/api/auth/me", { cookie: admin });
  if (preflight.status === 403) {
    console.error(
      `管理员处于强制改密状态（${preflight.json?.error ?? "403"}）：请先完成改密（登录 UI 或 verify-account 会代为改密）再运行本脚本`,
    );
    process.exit(1);
  }

  // ── 1. 管理员创建 Agent 令牌（scope: 全部，1 天）──
  console.log("[1] 签发令牌");
  const mint = await api("POST", "/api/api-tokens", {
    cookie: admin,
    body: { name: "agent-demo", scopes: ["*"], expiresInDays: 1 },
  });
  check("创建令牌 201", mint.status === 201);
  const TOKEN = mint.json?.data?.token;
  // 响应体只在创建时含明文 token；列表接口若也出现明文即越权泄露
  const mintedList = await api("GET", `/api/api-tokens`, { cookie: admin });
  const listHasPlaintext = JSON.stringify(mintedList.json?.data ?? []).includes(TOKEN ?? "\u0000");
  check("令牌以 itr_ 开头且仅此一次返回",
    typeof TOKEN === "string" && TOKEN.startsWith("itr_") && mintedList.status === 200 && !listHasPlaintext);

  // ── 2. Agent 上下文发现：工作区 → 项目 → 状态 → 成员 ──
  console.log("\n[2] 上下文发现（Bearer）");
  const projects = await api("GET", `/api/workspaces/main/projects`, { token: TOKEN });
  check("列出项目", projects.status === 200);
  const project = projects.json?.data?.find((p: any) => p.slug === DEMO_PROJECT);
  check("找到演示项目", !!project, `(${project?.name})`);
  const PID = project?.id;

  const states = await api("GET", `/api/projects/${PID}/states`, { token: TOKEN });
  const todo = (states.json?.data ?? []).find((s: any) => s.isDefault);
  check("列出状态（须含默认状态）", states.status === 200 && !!todo, `(默认状态 id: ${todo?.id?.slice(-6)})`);

  const members = await api("GET", "/api/workspaces/main/members", { token: TOKEN });
  const ww = members.json?.data?.find((m: any) => m.user.email === "wangwu@example.com");
  check("列出成员（200 找到王五）", members.status === 200 && !!ww, `(王五 id: ${ww?.user.id?.slice(-6)})`);

  // ── 3. Agent 创建 issue + 指派王五 ──
  console.log("\n[3] 创建 issue（归因：令牌所属用户）");
  // 未读基线：本轮将对王五产生 指派+提及 至少 2 条通知，断言要看增量而非绝对值
  const unreadBefore = ((await api("GET", "/api/notifications", { cookie: wangwu })).json?.data?.unreadCount ?? 0) as number;
  const created = await api("POST", `/api/projects/${PID}/issues`, {
    token: TOKEN,
    body: {
      title: "[agent-demo] 定时备份任务失败",
      descriptionText: "Agent 巡检发现备份作业连续 2 天未产出快照。",
      assigneeIds: [ww.user.id],
      stateId: todo.id,
    },
  });
  check("创建 issue 201", created.status === 201);
  const num = created.json?.data?.number;
  const createdIssueId: string | undefined = created.json?.data?.id; // 收尾自清理用
  const ref = `${DEMO_PROJECT.toUpperCase()}-${num}`;
  check("issue 序号已分配", typeof num === "number", `(${ref})`);

  // ── 4. Agent 更新 + 评论（@王五 → 走 M4 通知回路）──
  const updated = await api("PATCH", `/api/projects/${PID}/issues/${num}`, {
    token: TOKEN,
    body: { title: "[agent-demo] 定时备份任务失败（已升级）" },
  });
  check("更新 issue", updated.status === 200 && updated.json?.data?.title?.includes("已升级"));

  const comment = await api("POST", `/api/projects/${PID}/issues/${num}/comments`, {
    token: TOKEN,
    body: {
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "已自动生成诊断报告，请 " },
              { type: "mention", attrs: { id: ww.user.id, label: ww.user.name } },
              { type: "text", text: " 确认恢复策略。" },
            ],
          },
        ],
      },
    },
  });
  check("Agent 发布评论（含 @提及）", comment.status === 201);

  // ── 5. Agent 读取活动（审计/上下文）──
  console.log("\n[5] 读取活动流");
  const acts = await api("GET", `/api/projects/${PID}/issues/${num}/activities`, { token: TOKEN });
  const kinds = (acts.json?.data ?? []).map((a: any) => a.action);
  check("活动含 CREATED/ASSIGNED/UPDATED/COMMENTED",
    acts.status === 200 &&
      ["CREATED", "ASSIGNED", "UPDATED", "COMMENTED"].every((k) => kinds.includes(k)),
    `(${kinds.join(",")})`);

  // ── 6. 全局搜索 ──
  console.log("\n[6] 全局搜索");
  const search = await api("GET", `/api/search?q=${encodeURIComponent("备份")}`, { token: TOKEN });
  const hit = (search.json?.data?.issues ?? []).some((i: any) => i.number === num);
  check("搜索命中 Agent 刚建的 issue", search.status === 200 && hit);
  const hitIssues = search.json?.data?.issues ?? [];
  check("搜索结果带深链",
    search.status === 200 && hitIssues.length > 0 && hitIssues.every((i: any) => i.url?.startsWith("/w/")));

  // ── 6b. 自定义字段的 Agent 面（自描述 schema + 跨项目字段过滤）──
  console.log("\n[6b] 自定义字段（自描述 + 过滤）");
  // 管理员建一个字段（Agent 令牌也能建，但字段定义属管理动作，这里用管理员更贴近真实治理）
  const fieldKey = "agent_demo_sev";
  await api("POST", `/api/projects/${PID}/fields`, {
    cookie: admin,
    body: {
      key: fieldKey,
      name: "Agent 演示等级",
      type: "SELECT",
      options: [
        { value: "p1", label: "P1" },
        { value: "p2", label: "P2" },
      ],
    },
  });
  // 给刚建的 issue 打上字段值 p1
  await api("PATCH", `/api/projects/${PID}/issues/${num}`, {
    cookie: admin,
    body: { fieldValues: { [fieldKey]: "p1" } },
  });

  // 6b-1 自描述 JSON Schema
  const schema = await api("GET", `/api/projects/${PID}/fields/schema`, { token: TOKEN });
  const schemaData = schema.json?.data;
  check(
    "schema 端点自描述字段（JSON Schema）",
    schema.status === 200 &&
      schemaData?.properties?.[fieldKey]?.enum?.includes("p1") &&
      schemaData?.additionalProperties === false,
  );
  check("schema 带展示元信息 x-fields", Array.isArray(schemaData?.["x-fields"]) && schemaData["x-fields"].some((f: any) => f.key === fieldKey));

  // 6b-2 搜索按自定义字段过滤
  const cfSearch = await api(
    "GET",
    `/api/search?cf.${fieldKey}=p1`,
    { token: TOKEN },
  );
  const cfHit = (cfSearch.json?.data?.issues ?? []).some((i: any) => i.number === num);
  check("搜索支持 cf.<key> 字段过滤（无 q 纯字段检索）", cfSearch.status === 200 && cfHit);
  check(
    "搜索结果携带 fieldValues",
    (cfSearch.json?.data?.issues ?? []).some((i: any) => i.fieldValues?.[fieldKey] === "p1"),
  );
  // 回显必须精确到生效值——恒空对象若实现退化也能当场红
  const applied = cfSearch.json?.data?.appliedCustomFilters ?? {};
  check(
    "回显生效的字段过滤 + schema 发现入口",
    applied[fieldKey] === "p1" &&
      (cfSearch.json?.data?.matchedFieldProjects ?? []).length >= 1,
  );

  const cfMiss = await api("GET", `/api/search?cf.${fieldKey}=p9`, { token: TOKEN });
  check("不存在的枚举值 → 无命中", cfMiss.status === 200 && (cfMiss.json?.data?.issues ?? []).length === 0);

  // ── 7. 通知回路（王五应收到指派 + 提及）──
  console.log("\n[7] 通知回路（Agent 动作 → 同事通知）");
  const notif = await api("GET", "/api/notifications", { cookie: wangwu });
  // 按本次 issue 的唯一 ref 过滤，避免历史通知污染断言
  const thisRef = (notif.json?.data?.notifications ?? []).filter((n: any) =>
    String(n.title).includes(ref),
  );
  check("王五收到指派通知（本次 issue）", thisRef.some((n: any) => n.type === "ASSIGNED"), `(ref=${ref})`);
  // 提及必须以 MENTIONED 类型独立存在——mention 解析失效时王五只会收到 COMMENTED
  // （可被指派+评论顶替），按 type 断言才不可顶替
  check("王五收到提及通知（type=MENTIONED）", thisRef.some((n: any) => n.type === "MENTIONED"), `(ref=${ref})`);
  const unread = notif.json?.data?.unreadCount;
  // 增量断言：本轮恰产生 ≥2 条新未读（指派+提及）——绝对值 >0 只会漏报陈年未读堆积
  check("未读计数按本轮增量增加", typeof unread === "number" && unread >= unreadBefore + 2, `(unread=${unread}, before=${unreadBefore})`);

  // ── 8. 安全负例 ──
  console.log("\n[8] 安全边界");
  const forbidden1 = await api("GET", "/api/auth/me", { token: TOKEN });
  check("Bearer 访问认证端点 → 403", forbidden1.status === 403);

  const forbidden2 = await api("POST", "/api/api-tokens", { token: TOKEN, body: { name: "x", scopes: ["*"] } });
  check("Bearer 铸造新令牌 → 403", forbidden2.status === 403);

  const mint2 = await api("POST", "/api/api-tokens", {
    cookie: admin,
    body: { name: "read-only", scopes: ["issues:read"], expiresInDays: 1 },
  });
  const RO_TOKEN = mint2.json?.data?.token;
  const roRead = await api("GET", `/api/projects/${PID}/issues`, { token: RO_TOKEN });
  check("只读令牌可读 issue", roRead.status === 200);
  const roWrite = await api("POST", `/api/projects/${PID}/issues`, {
    token: RO_TOKEN,
    body: { title: "越权尝试" },
  });
  check("只读令牌写 issue → 403", roWrite.status === 403);

  const badToken = await api("GET", `/api/projects/${PID}/issues`, { token: "itr_invalid" });
  check("无效令牌 → 401", badToken.status === 401);

  const noAuth = await api("GET", `/api/projects/${PID}/issues`);
  check("无凭证 → 401", noAuth.status === 401);

  const searchNoScope = await api("GET", "/api/search?q=x", { token: RO_TOKEN });
  check("缺 search:read 的令牌调搜索 → 403", searchNoScope.status === 403);

  // ── 8b. AGENTS.md 的 scope 承诺回归：projects:read 覆盖 discover_context 全链 ──
  const mint3 = await api("POST", "/api/api-tokens", {
    cookie: admin,
    body: { name: "discover-only", scopes: ["projects:read"], expiresInDays: 1 },
  });
  const DISCOVER_TOKEN = mint3.json?.data?.token;
  const readStates = await api("GET", `/api/projects/${PID}/states`, { token: DISCOVER_TOKEN });
  check("projects:read 令牌可列状态（随项目 scope）", readStates.status === 200);
  const readMembers = await api("GET", `/api/workspaces/main/members`, { token: DISCOVER_TOKEN });
  check("projects:read 令牌可列工作区成员（随项目 scope）", readMembers.status === 200);
  const listIssues403 = await api("GET", `/api/projects/${PID}/issues`, { token: DISCOVER_TOKEN });
  check("projects:read 令牌列 issue → 403（缺 issues:read）", listIssues403.status === 403);
  const roActs = await api("GET", `/api/projects/${PID}/issues/${num}/activities`, { token: RO_TOKEN });
  check("issues:read 令牌可读活动流（activities 属 issue 读）", roActs.status === 200);

  // ── 9. 收尾：撤销令牌 ──
  console.log("\n[9] 令牌生命周期");
  const listTokens = await api("GET", "/api/api-tokens", { cookie: admin });
  check("列表不含令牌明文", JSON.stringify(listTokens.json).indexOf("itr_") === -1);
  // 只撤销本脚本铸的三枚令牌——删除管理员名下全部令牌会误伤真实运维凭证
  const mintedIds = [mint, mint2, mint3]
    .map((m) => ((m as any).json?.data?.id) as string | undefined)
    .filter((id): id is string => !!id);
  check("令牌列表中有本轮铸造的三枚", mintedIds.length === 3);
  for (const id of mintedIds) {
    const del = await api("DELETE", `/api/api-tokens/${id}`, { cookie: admin });
    check(`撤销令牌 ${id.slice(-6)} → 200`, del.status === 200);
  }
  const revoked = await api("GET", `/api/projects/${PID}/issues`, { token: TOKEN });
  check("撤销后旧令牌 → 401", revoked.status === 401);

  // ── 10. 收尾自清理 ──
  // issue 无删除 API，直连 Prisma 硬删本轮演示数据（issue + 演示字段）。
  // 清理成败计入断言（自删是承诺项）；历史残留的兜底清扫在 scripts/ops-cleanup.ts
  const cleaned = await cleanup(createdIssueId);
  check("收尾自清理完成（本轮 issue 与演示字段）", cleaned);

  finish("verify-agent");
}

async function cleanup(issueId: string | undefined): Promise<boolean> {
  if (!issueId) return true;
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      await prisma.issue.delete({ where: { id: issueId } });
      // 移除本脚本建的演示字段（幂等）
      await prisma.customField.deleteMany({ where: { key: "agent_demo_sev" } });
      console.log("已清理本轮演示 issue 与演示字段（自删除）");
      return true;
    } finally {
      await prisma.$disconnect();
    }
  } catch (e) {
    console.error("收尾自清理失败（残留需手工清理或跑 scripts/ops-cleanup.ts）：", e);
    return false;
  }
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(1);
});

export {};
