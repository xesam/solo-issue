/**
 * 个人工作台 · 端到端验收
 * 前置：服务运行中；先执行 scripts/ops-set-password.ts solo-issue@github.com <密码>
 * 运行：pnpm tsx scripts/verify-workbench.ts <admin初始密码>
 */

import "dotenv/config";

import { BASE_PATH } from "../src/lib/base-path";
import { check, finish } from "./lib/verify-kit";

const ROOT = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? "8081"}`;
const BASE = ROOT.endsWith(BASE_PATH) ? ROOT : `${ROOT}${BASE_PATH}`;

async function call(method: string, path: string, opts: { cookie?: string; body?: unknown; ip?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.ip) headers["x-forwarded-for"] = opts.ip;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json: any = await res.json().catch(() => null);
  return { status: res.status, json, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

async function main() {
  const initPw = process.argv[2];
  if (!initPw) {
    console.error("用法: pnpm tsx scripts/verify-workbench.ts <admin初始密码>");
    process.exit(1);
  }
  console.log("\n━━ 个人工作台验收 ━━\n");

  // ── 准备：管理员登录 + 清洗改密标记 ──
  const login1 = await call("POST", "/api/auth/login", { body: { email: "solo-issue@github.com", password: initPw }, ip: "10.99.1.1" });
  if (login1.status !== 200) {
    console.error("管理员登录失败，请先跑 ops-set-password"); process.exit(1);
  }
  const adminCookie = login1.cookie!;
  const adminId = login1.json?.data?.user?.id;
  const FINAL_PW = "wb-final-pass-1";
  if (login1.json?.data?.user?.mustChangePassword) {
    // 改密结果必须断言：改密失败会以"后续请求 401"的形态在远处炸出，不可归因
    const changed = await call("PUT", "/api/auth/password", { cookie: adminCookie, body: { currentPassword: initPw, newPassword: FINAL_PW } });
    check("清洗改密标记（前置）", changed.status === 200);
  }

  // ── 准备：李四（工作区 MEMBER）──
  const lisiEmail = `lisi-${Date.now()}@test.local`;
  const mk = await call("POST", "/api/admin/users", {
    cookie: adminCookie,
    body: { name: "李四", email: lisiEmail, initialPassword: "lisi-pass-1", memberships: [{ wsSlug: "main", role: "MEMBER" }] },
  });
  check("建号（李四，MEMBER）", mk.status === 201);
  const lisiLogin = await call("POST", "/api/auth/login", { body: { email: lisiEmail, password: "lisi-pass-1" }, ip: "10.99.1.2" });
  const lisiCookie = lisiLogin.cookie!;
  // 管理员建号自带「首登强制改密」标记，requireApiUser 的业务接口拦截会挡住后续
  // 全部步骤——让李四走完真人首登流程（改密端点在强制状态下仍放行）
  let lisiPw = "lisi-pass-1";
  if (lisiLogin.json?.data?.user?.mustChangePassword) {
    const changed = await call("PUT", "/api/auth/password", { cookie: lisiCookie, body: { currentPassword: lisiPw, newPassword: "lisi-pass-2" } });
    check("李四完成首登改密（清洗强制标记）", changed.status === 200);
    lisiPw = "lisi-pass-2";
  }

  // ── [1] 空状态与形状 ──
  console.log("\n[1] 基础");
  const empty = await call("GET", "/api/workbench?tab=assigned", { cookie: lisiCookie });
  check("未分配时 assigned 为空且 stats 形状正确",
    empty.status === 200 &&
      empty.json?.data?.issues?.length === 0 &&
      typeof empty.json?.data?.stats?.assigned === "number" &&
      typeof empty.json?.data?.stats?.created === "number");
  const badTab = await call("GET", "/api/workbench?tab=xxx", { cookie: lisiCookie });
  check("非法 tab → 422", badTab.status === 422);
  const noAuth = await call("GET", "/api/workbench?tab=assigned");
  check("未登录 → 401", noAuth.status === 401);

  // ── [2] 待我处理：指派 → 出现；完成 → 消失 ──
  console.log("\n[2] 待我处理（含状态语义过滤）");
  const proj = await call("POST", "/api/workspaces/main/projects", {
    cookie: adminCookie,
    body: { name: `工作台验证-${Date.now()}` },
  });
  check("创建公开验证项目", proj.status === 201);
  const PID = proj.json?.data?.id;
  const issueA = await call("POST", `/api/projects/${PID}/issues`, {
    cookie: adminCookie,
    body: { title: "F1-验证-李四的任务", assigneeIds: [mk.json?.data?.id] },
  });
  check("公开项目指派李四", issueA.status === 201);

  const wbAssigned = await call("GET", "/api/workbench?tab=assigned", { cookie: lisiCookie });
  const foundA = (wbAssigned.json?.data?.issues ?? []).some((i: any) => i.id === issueA.json?.data?.id);
  check("指派后出现在「待我处理」", foundA);
  // 李四是本轮新建用户，此刻 assigned 必然恰为 1——精确断言才能抓"计数翻倍/漏计"
  check("stats.assigned 计数正确", wbAssigned.json?.data?.stats?.assigned === 1, `(assigned=${wbAssigned.json?.data?.stats?.assigned})`);

  const states = await call("GET", `/api/projects/${PID}/states`, { cookie: adminCookie });
  check("项目状态列表可用（前置条件）", states.status === 200);
  const doneState = (states.json?.data ?? []).find((s: any) => s.group === "COMPLETED");
  check("存在 COMPLETED 组状态（前置条件）", !!doneState);
  const moveDone = await call("PATCH", `/api/projects/${PID}/issues/${issueA.json?.data?.number}`, {
    cookie: adminCookie,
    body: { stateId: doneState?.id },
  });
  // 前置条件必须断言事实而非"请求被接受"：空 body PATCH 也回 200，但什么都没移
  const movedIssue = await call("GET", `/api/projects/${PID}/issues/${issueA.json?.data?.number}`, { cookie: adminCookie });
  check("issue 已在已完成状态（前置条件）", moveDone.status === 200 && movedIssue.status === 200 && movedIssue.json?.data?.stateId === doneState?.id);
  const wbAfterDone = await call("GET", "/api/workbench?tab=assigned", { cookie: lisiCookie });
  const goneA = !(wbAfterDone.json?.data?.issues ?? []).some((i: any) => i.id === issueA.json?.data?.id);
  check("移入已完成状态后从「待我处理」消失（按状态分组过滤，非状态名）", goneA);

  // ── [3] 通知（原「提及我」tab 已并入通知的类型筛选）──
  console.log("\n[3] 通知（MENTIONED 事件即原「提及我」）");
  const mentionDoc = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "mention", attrs: { id: adminId, label: "管理员" } },
          { type: "text", text: " 看一下这个问题" },
        ],
      },
    ],
  };
  // 未读基线：提及必然造成管理员未读 +1——对管理员这种常驻账号，只有增量断言才能抓漏发
  const unreadBefore =
    (await call("GET", "/api/notifications", { cookie: adminCookie })).json?.data?.unreadCount ?? 0;
  const cm = await call("POST", `/api/projects/${PID}/issues/${issueA.json?.data?.number}/comments`, {
    cookie: lisiCookie,
    body: { body: mentionDoc },
  });
  check("李四在评论中 @管理员", cm.status === 201);
  const notifs = await call("GET", "/api/notifications", { cookie: adminCookie });
  const mentionNotif = (notifs.json?.data?.notifications ?? []).find(
    (n: any) => n.type === "MENTIONED" && n.url.includes(`/${issueA.json?.data?.number}`),
  );
  check("提及事件出现在通知流（type=MENTIONED，深链到 issue）", !!mentionNotif);
  check(
    "未读徽章较基线 +1（通知 tab 数据源）",
    (notifs.json?.data?.unreadCount ?? 0) >= unreadBefore + 1,
    `(before=${unreadBefore}, after=${notifs.json?.data?.unreadCount})`,
  );
  const wb422 = await call("GET", "/api/workbench?tab=mentioned", { cookie: adminCookie });
  check("旧 tab=mentioned 已下线（返回 422）", wb422.status === 422);

  // ── [4] 我创建的 ──
  const wbCreated = await call("GET", "/api/workbench?tab=created", { cookie: adminCookie });
  const createdMe = (wbCreated.json?.data?.issues ?? []).some((i: any) => i.id === issueA.json?.data?.id);
  check("管理员创建的 issue 出现在「我创建的」（含已完成）", createdMe);

  // ── [5] 私有项目：指派护栏 + 可见性 ──
  console.log("\n[5] 私有项目一致性（指派护栏）");
  const privProj = await call("POST", "/api/workspaces/main/projects", {
    cookie: adminCookie,
    body: { name: `机密-${Date.now()}`, isPrivate: true },
  });
  check("创建私有验证项目", privProj.status === 201);
  const PPID = privProj.json?.data?.id;
  const blocked = await call("POST", `/api/projects/${PPID}/issues`, {
    cookie: adminCookie,
    body: { title: "不应允许指派", assigneeIds: [mk.json?.data?.id] },
  });
  check("私有项目指派非成员 → 422（防幽灵任务）", blocked.status === 422);

  await call("POST", `/api/projects/${PPID}/members`, {
    cookie: adminCookie,
    body: { userId: mk.json?.data?.id, role: "MEMBER" },
  });
  const okAssign = await call("POST", `/api/projects/${PPID}/issues`, {
    cookie: adminCookie,
    body: { title: "私有项目-李四可见的任务", assigneeIds: [mk.json?.data?.id] },
  });
  check("加入成员后指派成功", okAssign.status === 201);

  const wbFinal = await call("GET", "/api/workbench?tab=assigned", { cookie: lisiCookie });
  const seesPrivate = (wbFinal.json?.data?.issues ?? []).some((i: any) => i.id === okAssign.json?.data?.id);
  check("项目成员在工作台可见私有项目任务", seesPrivate);

  // 非成员的可见性（张三式用户不在了，用 sysadmin 场景替代：无身份者看不到）
  const sysEmail = `sys-${Date.now()}@test.local`;
  await call("POST", "/api/admin/users", {
    cookie: adminCookie,
    body: { name: "临时无身份者", email: sysEmail, initialPassword: "tmp-pass-123", memberships: [] },
  });
  const tmpLogin = await call("POST", "/api/auth/login", { body: { email: sysEmail, password: "tmp-pass-123" }, ip: "10.99.1.3" });
  // 临时无身份者同样带首登强制改密标记——步行完全流程，否则工作台被改密拦截 403
  if (tmpLogin.json?.data?.user?.mustChangePassword) {
    const tmpChanged = await call("PUT", "/api/auth/password", { cookie: tmpLogin.cookie!, body: { currentPassword: "tmp-pass-123", newPassword: "tmp-pass-456" } });
    check("临时无身份者完成首登改密", tmpChanged.status === 200);
  }
  const tmpWb = await call("GET", "/api/workbench?tab=assigned", { cookie: tmpLogin.cookie! });
  check("无工作区身份者 → 空结果而非报错", tmpWb.status === 200 && tmpWb.json?.data?.issues?.length === 0);

  // 清理：停用结果必须断言（幂等但失败意味着残留会被下轮误判为"新建"）
  const cleanupDeact = await call("PATCH", `/api/admin/users/${mk.json?.data?.id}`, {
    cookie: adminCookie,
    body: { isActive: false },
  });
  check("停用本轮建的李四", cleanupDeact.status === 200);

  // U3.5：验收残留自清理——删本脚本建的项目（历史残留用 scripts/ops-cleanup.ts）。
  // 项目删除有非空护栏（仍有 issue → 422），过去只删项目不删 issue，"自清理"从未成功过
  // （残留直逼 ops-cleanup 兜底）——先把项目内 issue 逐条硬删，再删项目本身
  let cleaned = 0;
  for (const p of [proj, privProj]) {
    const pid = p.json?.data?.id;
    if (!pid) continue;
    // 列表接口缺省只回非归档——两态都抓，否则活动 issue 会留下、项目删不掉
    const issues = [
      ...(await call("GET", `/api/projects/${pid}/issues`, { cookie: adminCookie })).json?.data?.issues ?? [],
      ...(await call("GET", `/api/projects/${pid}/issues?archived=true`, { cookie: adminCookie })).json?.data?.issues ?? [],
    ];
    for (const i of issues) {
      await call("DELETE", `/api/projects/${pid}/issues/${i.number}`, { cookie: adminCookie });
    }
    const del = await call("DELETE", `/api/projects/${pid}`, { cookie: adminCookie });
    if (del.status === 200) cleaned += 1;
    else console.warn(`    ⚠️ 项目 ${p.json?.data?.name} 清理失败（${del.status} ${del.json?.error ?? ""}），待 ops-cleanup 兜底`);
  }
  check("自清理删除本轮项目", cleaned === 2, `(${cleaned}/2)`);
  // 已知残留：临时无身份者 sys-<ts>@test.local 不在本轮清理面内（无 admin 面删号出口），
  // 由 scripts/ops-cleanup.ts 兜底——这是"自清理"的边界，不算已清

  finish("verify-workbench");
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(1);
});

export {};
