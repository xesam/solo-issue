// 会话/页面上下文层需要请求上下文（next/headers 的 cookies()、next/navigation 的
// redirect()/notFound()）——此处以哨兵 mock 精确替身：断言跳转目标与 404 语义，
// 其余（DB 会话行的真伪、过期、停用）全部走真实 Prisma
vi.mock("next/headers", () => {
  const jar = new Map<string, string>();
  return {
    cookies: async () => ({
      get: (name: string) => {
        const value = jar.get(name);
        return value === undefined ? undefined : { value };
      },
    }),
    __setCookie: (name: string, value: string) => jar.set(name, value),
    __clear: () => jar.clear(),
  };
});

// 跳转/404 以哨兵错误承载：断言目标 URL 与 notFound 语义，不夹带 Next 内部实现
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("notfound");
  },
}));

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as nextHeaders from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/server/auth/hash";
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  getSessionUser,
  revokeOtherSessions,
} from "@/server/auth/session";
import { getUserContext, pageContext, pageProject } from "@/server/auth/pages";
import { requireApiUser, requireInstanceAdmin } from "@/server/auth/access";
import { createApiToken } from "@/server/auth/token";
import { addMember, cleanupFixtures, mkProject, mkUser, mkWorkspace } from "./helpers";

// mock 模块的侧通道工具（见工厂定义）：直接操作 cookie jar
const setSession = (token: string) =>
  (nextHeaders as unknown as { __setCookie: (n: string, v: string) => void }).__setCookie(
    SESSION_COOKIE,
    token,
  );
const clearCookies = () =>
  (nextHeaders as unknown as { __clear: () => void }).__clear();

let owner!: Awaited<ReturnType<typeof mkUser>>;
let ws!: Awaited<ReturnType<typeof mkWorkspace>>;
let pub!: Awaited<ReturnType<typeof mkProject>>;
let priv!: Awaited<ReturnType<typeof mkProject>>;

beforeAll(async () => {
  owner = await mkUser({ name: "会话主人" });
  ws = await mkWorkspace(owner.id);
  pub = await mkProject(ws.id, owner.id);
  priv = await mkProject(ws.id, owner.id, { isPrivate: true });
});

afterAll(cleanupFixtures);

// 断言助手：redirect/notFound 哨兵错误
const expectRedirect = async (p: Promise<unknown>, target: string) =>
  p.then(
    () => expect.unreachable(`应当 redirect 到 ${target}`),
    (e) => expect((e as Error).message).toBe(`redirect:${target}`),
  );
const expectNotFound = async (p: Promise<unknown>) =>
  p.then(
    () => expect.unreachable("应当 notFound"),
    (e) => expect((e as Error).message).toBe("notfound"),
  );

describe("getSessionUser", () => {
  it("无 cookie 返回 null；有效会话解析出用户", async () => {
    clearCookies();
    expect(await getSessionUser()).toBeNull();
    const t = await createSession(owner.id, { ip: "1.2.3.4", userAgent: "vitest" });
    setSession(t);
    expect((await getSessionUser())?.id).toBe(owner.id);
  });

  it("伪造 cookie（无对应行）返回 null", async () => {
    setSession("deadbeef");
    expect(await getSessionUser()).toBeNull();
  });

  it("过期会话：返回 null 且顺手删除行", async () => {
    const stale = await createSession(owner.id, {});
    const rowId = hashToken(stale);
    await prisma.session.update({
      where: { id: rowId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    setSession(stale);
    expect(await getSessionUser()).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: rowId } })).toBeNull(); // 惰性清扫
  });

  it("停用用户的会话返回 null（不下发用户对象）", async () => {
    const off = await mkUser({ isActive: false, name: "停用者" });
    const t = await createSession(off.id, {});
    setSession(t);
    expect(await getSessionUser()).toBeNull();
  });
});

describe("destroySession / revokeOtherSessions", () => {
  it("destroySession 删除当前会话行", async () => {
    const t1 = await createSession(owner.id, {});
    setSession(t1);
    await destroySession();
    expect(await prisma.session.findUnique({ where: { id: hashToken(t1) } })).toBeNull();
  });

  it("revokeOtherSessions 保留当前、下线其余", async () => {
    // 清场保证计数的确定性（本文件前序用例会留下 owner 的会话行）
    await prisma.session.deleteMany({ where: { userId: owner.id } });
    const keep = await createSession(owner.id, {});
    const old1 = await createSession(owner.id, {});
    const old2 = await createSession(owner.id, {});
    const revoked = await revokeOtherSessions(owner.id, hashToken(keep));
    expect(revoked).toBe(2);
    expect(await prisma.session.findUnique({ where: { id: hashToken(old1) } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: hashToken(old2) } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: hashToken(keep) } })).toBeTruthy();
  });
});

describe("pageContext / getUserContext / pageProject", () => {
  it("未登录一律 redirect 登录页", async () => {
    clearCookies();
    await expectRedirect(pageContext(ws.slug), "/signin");
    await expectRedirect(getUserContext(), "/signin");
    await expectRedirect(pageProject(ws.slug, pub.slug), "/signin");
  });

  it("mustChangePassword 被强制改密拦截（服务端护栏而非 UI 提示）", async () => {
    const pending = await mkUser({ mustChangePassword: true, name: "待改密" });
    await addMember(ws.id, pending.id, "MEMBER");
    setSession(await createSession(pending.id, {}));
    await expectRedirect(pageContext(ws.slug), "/change-password");
  });

  it("未知工作区/非成员 notFound（404 防枚举）；成员拿到上下文", async () => {
    setSession(await createSession(owner.id, {}));
    await expectNotFound(pageContext("no-such-ws"));
    const stranger = await mkUser({ name: "陌生人" });
    setSession(await createSession(stranger.id, {}));
    await expectNotFound(pageContext(ws.slug));
    setSession(await createSession(owner.id, {}));
    const ctx = await pageContext(ws.slug);
    expect(ctx.user.id).toBe(owner.id);
    expect(ctx.member.role).toBe("OWNER");
  });

  it("pageProject：公开项目直通（OWNER 视为项目 ADMIN）；未知 slug 404", async () => {
    const p = await pageProject(ws.slug, pub.slug);
    expect(p.project.id).toBe(pub.id);
    expect(p.projectMemberRole).toBe("ADMIN");
    await expectNotFound(pageProject(ws.slug, "no-such-proj"));
    const me = await getUserContext();
    expect(me.workspaces.map((w) => w.slug)).toContain(ws.slug);
  });

  it("私有项目：非成员 404；项目成员可见；OWNER 可见", async () => {
    const someone = await mkUser({ name: "普通成员" });
    setSession(await createSession(someone.id, {}));
    await expectNotFound(pageProject(ws.slug, priv.slug));

    // 项目成员可见
    await addMember(ws.id, someone.id, "MEMBER");
    await prisma.projectMember.create({
      data: { projectId: priv.id, userId: someone.id, role: "MEMBER" },
    });
    const visible = await pageProject(ws.slug, priv.slug);
    expect(visible.project.id).toBe(priv.id);
    expect(visible.projectMemberRole).toBe("MEMBER");

    setSession(await createSession(owner.id, {}));
    const asOwner = await pageProject(ws.slug, priv.slug);
    expect(asOwner.projectMemberRole).toBe("ADMIN");
  });
});

describe("requireApiUser / requireInstanceAdmin（请求层双通道）", () => {
  it("会话通道：无 cookie 401；有效会话解析用户；强制改密期 403", async () => {
    clearCookies();
    await expectHttp(requireApiUser(new Request("http://x/api/auth/me")), 401);

    setSession(await createSession(owner.id, {}));
    const ok = await requireApiUser(new Request("http://x/api/auth/me"));
    expect(ok.id).toBe(owner.id);

    const pending = await mkUser({ mustChangePassword: true, name: "改密拦截" });
    setSession(await createSession(pending.id, {}));
    await expectHttp(requireApiUser(new Request("http://x/api/auth/me")), 403);
  });

  it("requireInstanceAdmin：非管理员 403，管理员放行会话通道（/api/admin 本就是 Bearer 禁区）", async () => {
    const mere = await mkUser({ name: "普通人" });
    setSession(await createSession(mere.id, {}));
    await expectHttp(
      requireInstanceAdmin(new Request("http://x/api/admin/users")),
      403,
    );

    const bigBoss = await mkUser({ isAdmin: true, name: "超管" });
    setSession(await createSession(bigBoss.id, {}));
    const u = await requireInstanceAdmin(new Request("http://x/api/admin/users"));
    expect(u.id).toBe(bigBoss.id);
  });
});

const expectHttp = async (p: Promise<unknown>, status: number) =>
  p.then(
    () => expect.unreachable(`应当 ${status}`),
    (e) => expect((e as { status?: number }).status).toBe(status),
  );
