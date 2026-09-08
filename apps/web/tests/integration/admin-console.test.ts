import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/api";
import {
  adminCreateUser,
  adminCreateWorkspace,
  adminListUsers,
  adminListWorkspaceMembers,
  adminRenameWorkspace,
  adminResetPassword,
  adminSetWorkspaceRole,
  adminUpdateUser,
} from "@/server/services/admin-user";
import { createSession } from "@/server/auth/session";
import { verifyPasswordTimingSafe } from "@/server/auth/password";
import {
  addMember,
  cleanupFixtures,
  mkUser,
  mkWorkspace,
  trackUser,
  trackWorkspace,
  uid,
} from "./helpers";

// U2 管理面：服务直连回归（路由层护栏由 verify-agent 安全段背书，
// 此处锚定服务语义：建号/改键/停用吊销/角色护栏）
// 注意：「最后一个活跃超管不可移除」护栏依赖全库状态，无法在共享开发库安全
// 造红，由验收脚本层背书，此处只测工作区 OWNER 维度护栏（可完全隔离）。

const expectHttpError = async (p: Promise<unknown>, status: number) => {
  try {
    await p;
    expect.unreachable(`应当 ${status}`);
  } catch (e) {
    expect((e as { status?: number }).status).toBe(status);
  }
};

let ws!: Awaited<ReturnType<typeof mkWorkspace>>;
let admin!: Awaited<ReturnType<typeof mkUser>>;
// 全库 q 查询断言要求名字唯一：固定名在残留行/上轮清理失败时会假红，故带随机尾
const adminName = uid("治理台操作者");

beforeAll(async () => {
  admin = await mkUser({ name: adminName, isAdmin: true });
  ws = await mkWorkspace(admin.id);
});

afterAll(cleanupFixtures);

describe("adminListUsers（过滤/分页）", () => {
  const marker = uid("标记");
  const names = [`${marker}一`, `${marker}二`, `${marker}三`];

  beforeAll(async () => {
    // mkUser 内部已自登记（helpers 契约），无需再 trackUser；
    // 间隔 3ms 建号保证 createdAt 互异——分页连续性锚依赖稳定的 createdAt asc 序
    for (const name of names) {
      await mkUser({ name });
      await new Promise((r) => setTimeout(r, 3));
    }
  });

  it("q 按姓名/邮箱模糊命中；take/skip 正确切片", async () => {
    const r = await adminListUsers({ q: marker });
    expect(r.total).toBe(names.length);
    expect(r.users.every((u) => u.name.startsWith(marker))).toBe(true);
    const first = await adminListUsers({ q: marker, take: 2 });
    expect(first.users).toHaveLength(2);
    const second = await adminListUsers({ q: marker, take: 2, skip: 2 });
    expect(second.users).toHaveLength(names.length - 2);
    // 翻页连续性硬锚：skip 2 的首行即全量结果第 3 行（off-by-one / 越位切片/乱序会红）
    expect(second.users[0]?.id).toBe(r.users[2]?.id);
  });

  it("status 与 adminOnly 过滤组合", async () => {
    const probe = uid("停用标记");
    const u = await mkUser({ name: probe, isActive: false });
    const disabled = await adminListUsers({ q: probe, status: "disabled" });
    expect(disabled.total).toBe(1);
    const activeProbe = await adminListUsers({ q: probe, status: "active" });
    expect(activeProbe.total).toBe(0);
    expect(
      (await adminListUsers({ adminOnly: true, q: adminName })).total,
    ).toBe(1);
  });

  it("列表形态：hasPassword 派生字段与 memberships 展开", async () => {
    const r = await adminListUsers({ q: adminName });
    expect(r.users).toHaveLength(1);
    const row = r.users[0]!;
    // hasPassword 派生自 passwordHash 的有无：mkUser 直建（origin=EMAIL、无 passwordHash）→ false；
    // 删掉该派生字段本断言即红
    expect(row.hasPassword).toBe(false);
    expect(row.memberships[0]!.wsSlug).toBe(ws.slug);
    expect(row.memberships[0]!.role).toBe("OWNER");
  });

  it("hasPassword 派生字段的正向锚：有密码账号为 true", async () => {
    const probe = uid("有密码者");
    const u = await adminCreateUser({ name: probe, email: `${uid("pw")}@test.invalid`, initialPassword: "Abcdef12" });
    trackUser(u.id);
    const row = (await adminListUsers({ q: probe })).users[0]!;
    expect(row.hasPassword).toBe(true);
  });
});

describe("adminCreateUser（建号）", () => {
  it("正常建号：bcrypt 初始密码 + 强制首登改密 + 直接入组", async () => {
    const email = `${uid("newadmin")}@test.invalid`;
    const u = await adminCreateUser({
      name: "新同事",
      email,
      initialPassword: "初始密码!23",
      memberships: [{ wsSlug: ws.slug, role: "MEMBER" }],
    });
    trackUser(u.id);
    expect(u.mustChangePassword).toBe(true);
    expect(u.passwordHash).toBeTruthy();
    const m = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: ws.id, userId: u.id } },
    });
    expect(m?.role).toBe("MEMBER");
  });

  it("邮箱近似撞名拒绝（大小写不敏感）；工作区不存在 422", async () => {
    const email = `${uid("dup")}@test.invalid`;
    const u = await adminCreateUser({ name: "先来", email, initialPassword: "密码1234" });
    trackUser(u.id);
    await expectHttpError(
      adminCreateUser({
        name: "后来",
        email: email.toUpperCase(), // insensitive 查重
        initialPassword: "密码1234",
      }),
      422,
    );
    await expectHttpError(
      adminCreateUser({
        name: "坏组",
        email: `${uid("x")}@test.invalid`,
        initialPassword: "密码1234",
        memberships: [{ wsSlug: "no-such-ws", role: "MEMBER" }],
      }),
      422,
    );
  });
});

describe("adminUpdateUser（改键/停用）", () => {
  it("邮箱三态：字符串改键全库查重拒绝撞名；有密码账号清空邮箱拒绝", async () => {
    const a = await adminCreateUser({ name: "甲", email: `${uid("a")}@test.invalid`, initialPassword: "密码1234" });
    const b = await adminCreateUser({ name: "乙", email: `${uid("b")}@test.invalid`, initialPassword: "密码1234" });
    trackUser(a.id);
    trackUser(b.id);
    await expectHttpError(
      adminUpdateUser(b.id, { email: a.email! }),
      422, // emailTaken
    );
    await expectHttpError(
      adminUpdateUser(b.id, { email: null }),
      422, // emailClearWithPassword
    );
    // 合法清空：IM 建号账号（无密码）
    const imUser = await mkUser({ passwordHash: null, email: null, name: "企微建号" });
    await adminUpdateUser(imUser.id, { email: null });
    // 合法改键
    await adminUpdateUser(b.id, { email: `${uid("moved")}@test.invalid` });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: b.id } })).email,
    ).toContain("moved");
  });

  it("停用即吊销全部会话；停用用户出现在 status=disabled 过滤", async () => {
    const u = await adminCreateUser({ name: "将停用", email: `${uid("off")}@test.invalid`, initialPassword: "密码1234" });
    trackUser(u.id);
    await createSession(u.id, {});
    await adminUpdateUser(u.id, { isActive: false });
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
    const row = (await adminListUsers({ q: u.email! })).users[0]!;
    expect(row.isActive).toBe(false);
  });
});

describe("adminResetPassword", () => {
  it("无邮箱账号 422（密码登录无处兑现）", async () => {
    const imUser = await mkUser({ email: null, name: "无邮箱" });
    await expectHttpError(adminResetPassword(imUser.id, "密码1234"), 422);
  });

  it("重置写哈希 + 强制改密 + 旧会话下线", async () => {
    const u = await adminCreateUser({ name: uid("要重置"), email: `${uid("rp")}@test.invalid`, initialPassword: "老密码123" });
    trackUser(u.id);
    await createSession(u.id, {});
    await adminResetPassword(u.id, "新密码456");
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.mustChangePassword).toBe(true);
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
    // 副作用锚：新密码可验、旧密码失效——重置应写 passwordHash 而非只改标记
    expect(await verifyPasswordTimingSafe("新密码456", row.passwordHash)).toBe(true);
    expect(await verifyPasswordTimingSafe("老密码123", row.passwordHash)).toBe(false);
  });
});

describe("adminSetWorkspaceRole（角色治理 + OWNER 护栏）", () => {
  it("加/改/移除三段；未知工作区/停用用户拒绝", async () => {
    const u = await mkUser({ name: "组员" });
    await adminSetWorkspaceRole(u.id, { wsSlug: ws.slug, role: "MEMBER" });
    const m1 = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: ws.id, userId: u.id } },
    });
    expect(m1?.role).toBe("MEMBER");

    await adminSetWorkspaceRole(u.id, { wsSlug: ws.slug, role: "GUEST" });
    expect(
      (await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: u.id } },
      }))?.role,
    ).toBe("GUEST");

    await adminSetWorkspaceRole(u.id, { wsSlug: ws.slug, role: null });
    expect(
      await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: ws.id, userId: u.id } },
      }),
    ).toBeNull();
    await adminSetWorkspaceRole(u.id, { wsSlug: ws.slug, role: null }); // 幂等

    await expectHttpError(
      adminSetWorkspaceRole(u.id, { wsSlug: "no-such", role: "MEMBER" }),
      404,
    );
    const off = await mkUser({ isActive: false, name: "停用组员" });
    await expectHttpError(
      adminSetWorkspaceRole(off.id, { wsSlug: ws.slug, role: "MEMBER" }),
      422, // userDisabledEnableFirst
    );
  });

  it("唯一工作区 OWNER 移除自身被护栏拦截（422）", async () => {
    const solo = await mkWorkspace(); // 暂无 OWNER
    const ctrlOwner = await mkUser({ name: "独占负责人" });
    await addMember(solo.id, ctrlOwner.id, "OWNER");
    // 唯一 OWNER：移除自身会令工作区失去治理人 → 护栏 422
    await expectHttpError(
      adminSetWorkspaceRole(ctrlOwner.id, { wsSlug: solo.slug, role: null }),
      422,
    );
    // 有第二个 OWNER 后移除恢复正常
    await addMember(solo.id, admin.id, "OWNER");
    await adminSetWorkspaceRole(ctrlOwner.id, { wsSlug: solo.slug, role: null });
    expect(
      await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: solo.id, userId: ctrlOwner.id } },
      }),
    ).toBeNull();
  });
});

describe("工作区治理", () => {
  it("adminCreateWorkspace：slug 格式校验、撞名拒绝、trim 落库", async () => {
    await expectHttpError(
      adminCreateWorkspace({ name: "坏", slug: "UPPER" }),
      422,
    );
    const slug = uid("vws").toLowerCase();
    const created = await adminCreateWorkspace({ name: "  正常  ", slug });
    trackWorkspace(created.id);
    expect(created.name).toBe("正常");
    await expectHttpError(
      adminCreateWorkspace({ name: "撞名", slug }),
      422,
    );
    const renamed = await adminRenameWorkspace(created.id, "  改名  ");
    expect(renamed.name).toBe("改名");
  });

  it("adminListWorkspaceMembers：成员与可加候选互斥，未入组活跃号才进候选", async () => {
    const solo = await mkWorkspace(admin.id);
    const insider = await mkUser({ name: "已在组" });
    const outsider2 = await mkUser({ name: "可加入" });
    const disabled = await mkUser({ name: "停用不可加", isActive: false });
    await addMember(solo.id, insider.id, "MEMBER");
    const { members, candidates } = await adminListWorkspaceMembers(solo.id);
    expect(members.some((m) => m.userId === insider.id)).toBe(true);
    expect(candidates.some((c) => c.id === outsider2.id)).toBe(true);
    expect(candidates.some((c) => c.id === insider.id)).toBe(false);
    expect(candidates.some((c) => c.id === disabled.id)).toBe(false);
    await expectHttpError(adminListWorkspaceMembers("55-not-exist"), 404);
  });
});
