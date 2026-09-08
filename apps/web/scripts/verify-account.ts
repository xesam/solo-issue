/**
 * 账号与角色 · 端到端验收
 * 前置：① 服务运行中 ② 管理员已设密码（本机可用 scripts/ops-set-password.ts solo-issue@github.com <密码> 完成）
 * 运行：pnpm tsx scripts/verify-account.ts <admin密码>
 * 注意：会创建并停用 test.local 测试账号、建/删「机密计划-」私有项目——只应在验收环境运行
 */

import "dotenv/config";

import { BASE_PATH } from "../src/lib/base-path";
import { check, finish, skip } from "./lib/verify-kit";

const ROOT = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? "8081"}`;
const BASE = ROOT.endsWith(BASE_PATH) ? ROOT : `${ROOT}${BASE_PATH}`;
const WS = "main";

async function call(
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; ip?: string } = {},
) {
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

// 每个逻辑用户独立虚拟 IP：限流按"用户"而非"脚本进程"计（脚本测试用）
const ipOf = (email: string) =>
  "10.99.0." + (Math.abs([...email].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 250 + 1);

async function login(email: string, password: string) {
  const r = await call("POST", "/api/auth/login", { body: { email, password }, ip: ipOf(email) });
  return r;
}

async function main() {
  const adminInitPw = process.argv[2];
  if (!adminInitPw) {
    console.error("用法: pnpm tsx scripts/verify-account.ts <admin初始密码>");
    process.exit(1);
  }
  console.log("\n━━ 账号与角色矩阵验收 ━━\n");

  // ── 1. 密码登录与防枚举 ──
  console.log("[1] 登录与防枚举");
  const wrong = await login("solo-issue@github.com", "wrong-password-x");
  const unknown = await login("nobody@example.com", "whatever-123");
  // 脚本无 cookie → 错误文案按默认 locale（en）出；断言英文事实源文案
  check("错误密码 → 401 且文案统一", wrong.status === 401 && wrong.json?.error === "Incorrect email or password");
  check(
    "不存在邮箱 → 401 且文案与错误密码完全一致（防枚举）",
    unknown.status === 401 && unknown.json?.error === "Incorrect email or password",
  );

  const init = await login("solo-issue@github.com", adminInitPw);
  check("正确密码 → 200", init.status === 200, `(mustChangePassword=${init.json?.data?.user?.mustChangePassword})`);
  const adminCookie = init.cookie!;
  const adminCookieB = (await login("solo-issue@github.com", adminInitPw)).cookie!; // 第二会话，供吊销断言

  // ── 2. 首登强制改密 ──
  console.log("\n[2] 强制改密");
  if (init.json?.data?.user?.mustChangePassword) {
    const NEW_PW = "admin-new-pass-1";
    // 用会话 B 改密：B 保留、A（其他会话）应被吊销
    const changed = await call("PUT", "/api/auth/password", {
      cookie: adminCookieB,
      body: { currentPassword: adminInitPw, newPassword: NEW_PW },
    });
    check("强制改密成功（会话 B）", changed.status === 200);
    const staleA = await call("GET", "/api/auth/me", { cookie: adminCookie });
    check("改密吊销其他会话（会话 A → 401）", staleA.status === 401);
    const aliveB = await call("GET", "/api/auth/me", { cookie: adminCookieB });
    check("改密保留当前会话（B 仍有效）", aliveB.status === 200);
    const relogin = await login("solo-issue@github.com", NEW_PW);
    check("改密后可登录且标记清除", relogin.status === 200 && relogin.json?.data?.user?.mustChangePassword === false);
    await runRest(adminCookieB, NEW_PW);
  } else {
    skip("强制改密段", "管理员已非待改密状态");
    await runRest(adminCookie, adminInitPw);
  }

  finish("verify-account");
}

async function runRest(adminCookie: string, adminPw: string) {
  // ── 3. 管理台与 D1 分离 ──
  console.log("\n[3] 管理台与 D1 分离（超级管理员不穿透业务）");
  const mkSys = await call("POST", "/api/admin/users", {
    cookie: adminCookie,
    body: {
      name: "系统管理员",
      email: `sysadmin-${Date.now()}@test.local`,
      initialPassword: "sysadmin-pass-1",
      isAdmin: true,
      // 故意不给工作区成员身份
    },
  });
  check("建号（超级管理员，无工作区身份）", mkSys.status === 201);

  const sys = await login(mkSys.json?.data?.email ?? "", "sysadmin-pass-1");
  const sysCookie = sys.cookie!;
  check("新管理员可登录且强制改密标记生效", sys.status === 200 && sys.json?.data?.user?.mustChangePassword === true);
  // 首登改密必须断言结果——404/422 会让后续 [3] 段的断言以误读形态集体红（归因失真）
  const sysPw = await call("PUT", "/api/auth/password", {
    cookie: sysCookie,
    body: { currentPassword: "sysadmin-pass-1", newPassword: "sysadmin-pass-2" },
  });
  check("新管理员首登改密（PUT password）", sysPw.status === 200);

  const sysBiz = await call("GET", `/api/workspaces/${WS}/projects`, { cookie: sysCookie });
  // 404 语义：超管无工作区身份，与非成员同为“不可见即不存在”
  check("D1：超级管理员访问业务 API → 404（不穿透业务数据）", sysBiz.status === 404);
  const sysAdminApi = await call("GET", "/api/admin/users", { cookie: sysCookie });
  check("D1：超级管理员访问管理台 API → 200", sysAdminApi.status === 200);

  const zhangsanEmail = `zhangsan-${Date.now()}@test.local`;
  const mkUser = await call("POST", "/api/admin/users", {
    cookie: adminCookie,
    body: {
      name: "张三",
      email: zhangsanEmail,
      initialPassword: "zhangsan-pass-1",
      memberships: [{ wsSlug: WS, role: "MEMBER" }],
    },
  });
  check("建号（工作区 MEMBER）", mkUser.status === 201);
  const zs = await login(zhangsanEmail, "zhangsan-pass-1");
  const zsCookie = zs.cookie!;
  // 管理员建号后带「首登强制改密」标记，requireApiUser 对业务接口的强制改密拦截
  // 会挡住后续步骤——让 zs 走完真人首登流程（改密端点在强制状态下仍放行）
  let zsPw = "zhangsan-pass-1";
  if (zs.json?.data?.user?.mustChangePassword) {
    const zsChanged = await call("PUT", "/api/auth/password", {
      cookie: zsCookie,
      body: { currentPassword: zsPw, newPassword: "zhangsan-pass-2" },
    });
    check("zs 完成首登改密（清除强制标记）", zsChanged.status === 200);
    zsPw = "zhangsan-pass-2";
  }
  const zsAdminApi = await call("GET", "/api/admin/users", { cookie: zsCookie });
  check("普通成员访问管理台 → 403", zsAdminApi.status === 403);

  // ── 3.5 邮箱可编辑（登录键归一化与护栏）──
  console.log("\n[3.5] 邮箱可编辑（登录键归一化与护栏）");
  const zsNewEmail = `zs-Renamed-${Date.now()}@Example.TEST`; // 大小写混合，验证归一化
  const zsEdit = await call("PATCH", `/api/admin/users/${mkUser.json?.data?.id}`, {
    cookie: adminCookie,
    body: { email: zsNewEmail },
  });
  check("管理端改邮箱（大写变体入参）", zsEdit.status === 200);
  const zsFinalEmail = zsNewEmail.toLowerCase(); // 后段登录/停用断言用改名后邮箱
  const zsRelogin = await login(zsFinalEmail, zsPw);
  check("归一化：小写形式可登录", zsRelogin.status === 200);
  const zsOldSession = await call("GET", `/api/workspaces/${WS}/projects`, { cookie: zsCookie });
  check("改邮箱不吊销既有会话", zsOldSession.status === 200);
  const zsDupe = await call("PATCH", `/api/admin/users/${mkUser.json?.data?.id}`, {
    cookie: adminCookie,
    body: { email: "solo-issue@github.com" },
  });
  check("撞既有邮箱 → 422", zsDupe.status === 422);
  const zsClear = await call("PATCH", `/api/admin/users/${mkUser.json?.data?.id}`, {
    cookie: adminCookie,
    body: { email: null },
  });
  check("有密码账号清空邮箱 → 422", zsClear.status === 422);

  // ── 4. 私有项目可见性 ──
  console.log("\n[4] 私有项目可见性");
  const mkProj = await call("POST", `/api/workspaces/${WS}/projects`, {
    cookie: adminCookie,
    body: { name: "机密计划-" + Date.now(), slug: undefined, isPrivate: true },
  });
  const PID = mkProj.json?.data?.id;
  check("创建私有项目", mkProj.status === 201);

  // 负向断言的正锚点：先证明「敏感数据确实存在」，否则"不出现"恒真（接口坏了也绿）
  const secret = await call("POST", `/api/projects/${PID}/issues`, {
    cookie: adminCookie,
    body: { title: "绝密-公开源代码上线 " + Date.now(), descriptionText: "verif-keyword-xyz" },
  });
  check("私有项目创建含关键词的 issue（泄露断言前提）", secret.status === 201);

  const zsProjects = await call("GET", `/api/workspaces/${WS}/projects`, { cookie: zsCookie });
  // 先要求接口本身 200：500/坏 JSON（json=null）会让 ?? [] 吞成"无数据"，断言恒真
  check("非成员项目列表接口可用（前提）", zsProjects.status === 200);
  check("非成员列表不出现私有项目", !(zsProjects.json?.data ?? []).some((p: any) => p.id === PID));
  const zsDirect = await call("GET", `/api/projects/${PID}/issues`, { cookie: zsCookie });
  // 404 语义（防枚举）：非成员不可区分“私有项目”与“不存在的项目”
  check("非成员直接访问 → 404（不可见即不存在）", zsDirect.status === 404);
  const zsSearch = await call("GET", "/api/search?q=verif-keyword-xyz", { cookie: zsCookie });
  check("非成员全局搜索接口可用（前提）", zsSearch.status === 200);
  check("非成员全局搜索不泄露私有项目内容", !(zsSearch.json?.data?.issues ?? []).some((i: any) => i.project?.id === PID));
  // 正锚点复核：管理员本人必须能搜到（证明数据可检索，前面的“搜不到”才有意义）
  const adminSearch = await call("GET", "/api/search?q=verif-keyword-xyz", { cookie: adminCookie });
  check("成员可搜索到该 issue（泄露断言的正锚点）", adminSearch.status === 200 && (adminSearch.json?.data?.issues ?? []).some((i: any) => i.project?.id === PID));

  // 加入为 MEMBER
  await call("POST", `/api/projects/${PID}/members`, {
    cookie: adminCookie,
    body: { userId: mkUser.json?.data?.id, role: "MEMBER" },
  });
  const zsSee = await call("GET", `/api/projects/${PID}/issues`, { cookie: zsCookie });
  check("加入成员后可见", zsSee.status === 200);
  const zsWrite = await call("POST", `/api/projects/${PID}/issues`, {
    cookie: zsCookie,
    body: { title: "张三在私有项目提交的问题" },
  });
  check("私有项目 MEMBER 可写", zsWrite.status === 201);

  // 降为 GUEST → 只读
  await call("POST", `/api/projects/${PID}/members`, {
    cookie: adminCookie,
    body: { userId: mkUser.json?.data?.id, role: "GUEST" },
  });
  const zsGuestWrite = await call("POST", `/api/projects/${PID}/issues`, {
    cookie: zsCookie,
    body: { title: "不应成功" },
  });
  check("私有项目 GUEST 只读 → 403", zsGuestWrite.status === 403);

  // 移除
  await call("DELETE", `/api/projects/${PID}/members?userId=${mkUser.json?.data?.id}`, { cookie: adminCookie });
  const zsAfter = await call("GET", `/api/projects/${PID}/issues`, { cookie: zsCookie });
  check("移除后不可见 → 404", zsAfter.status === 404);

  // ── 5. 护栏 ──
  console.log("\n[5] 护栏");
  const meCall = await call("GET", "/api/auth/me", { cookie: adminCookie });
  const adminId = meCall.json?.data?.user?.id;
  check("取管理员 id（护栏前提）", meCall.status === 200 && !!adminId);
  // 先停用本轮创建的 sysadmin，使 admin 成为唯一活跃超级管理员（护栏前提）
  const deactSys = await call("PATCH", `/api/admin/users/${mkSys.json?.data?.id}`, {
    cookie: adminCookie,
    body: { isActive: false },
  });
  // 结果必须断言：若停用失败，后续"最后一个超管"的两条 422 失败会被误归因为护栏失灵
  check("停用本轮 sysadmin（护栏前提）", deactSys.status === 200);
  const selfDemote = await call("PATCH", `/api/admin/users/${adminId}`, {
    cookie: adminCookie,
    body: { isAdmin: false },
  });
  check("最后一个超级管理员不可被降级 → 422", selfDemote.status === 422);
  const selfDeactivate = await call("PATCH", `/api/admin/users/${adminId}`, {
    cookie: adminCookie,
    body: { isActive: false },
  });
  check("最后一个超级管理员不可被停用 → 422", selfDeactivate.status === 422);
  const demoteOwner = await call("POST", `/api/admin/users/${adminId}/roles`, {
    cookie: adminCookie,
    body: { wsSlug: WS, role: "MEMBER" },
  });
  check("工作区最后一个 OWNER 不可被移出 → 422", demoteOwner.status === 422);

  // 停用 → 会话吊销（停用结果不断言：下游"会话吊销→401"即为下游校验，双 kill 立现）
  await call("PATCH", `/api/admin/users/${mkUser.json?.data?.id}`, {
    cookie: adminCookie,
    body: { isActive: false },
  });
  const zsDead = await call("GET", "/api/auth/me", { cookie: zsCookie });
  check("停用即吊销会话", zsDead.status === 401);
  const zsReLogin = await login(zsFinalEmail, zsPw);
  check("停用后登录 → 403", zsReLogin.status === 403);

  // 清理：zs 已停用；sysadmin 已在 [5] 停用

  // U3.5：验收残留自清理——删本脚本建的私有项目（历史残留用 scripts/ops-cleanup.ts）。
  // 项目删除有非空护栏（仍有 issue → 422），先逐条硬删项目内 issue（含归档），再删项目
  if (PID) {
    // 列表接口缺省只回非归档——两态都抓，否则活动 issue 会留下、项目删不掉
    const secretIssues = [
      ...(await call("GET", `/api/projects/${PID}/issues`, { cookie: adminCookie })).json?.data?.issues ?? [],
      ...(await call("GET", `/api/projects/${PID}/issues?archived=true`, { cookie: adminCookie })).json?.data?.issues ?? [],
    ];
    for (const i of secretIssues) {
      await call("DELETE", `/api/projects/${PID}/issues/${i.number}`, { cookie: adminCookie });
    }
    const delProj = await call("DELETE", `/api/projects/${PID}`, { cookie: adminCookie });
    // 清理是承诺项：失败必红（历史残留的兜底清扫在 scripts/ops-cleanup.ts）
    check("清理本脚本建的私有项目", delProj.status === 200, `(${delProj.status} ${delProj.json?.error ?? ""})`);
  }
}

main().catch((e) => {
  console.error("脚本异常:", e);
  process.exit(1);
});

export {};
