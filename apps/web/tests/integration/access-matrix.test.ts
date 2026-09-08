import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiToken } from "@/server/auth/token";
import {
  requireProject,
  requireProjectAdmin,
  requireProjectWrite,
  requireWorkspace,
  requireWorkspaceAdmin,
} from "@/server/auth/access";
import { listProjectMembers, listProjects } from "@/server/services/project";
import { listWorkspaceMembers } from "@/server/services/workspace";
import {
  addMember,
  bearerRequest,
  cleanupFixtures,
  mkProject,
  mkUser,
  mkWorkspace,
} from "./helpers";

// 权限矩阵（角色 × 项目可见性 × 写/管）：全部走 Bearer 通道，
// 与 requireXxx 在 HTTP 路由层的真实调用形态一致。
// 矩阵设计依据：docs/04-workspace-design.md 能力矩阵与 access.ts 注释。

const expectHttpError = async (p: Promise<unknown>, status: number) => {
  try {
    await p;
    expect.unreachable(`应当 ${status}`);
  } catch (e) {
    expect((e as { status?: number }).status).toBe(status);
  }
};

let owner!: Awaited<ReturnType<typeof mkUser>>;
let member!: Awaited<ReturnType<typeof mkUser>>;
let guest!: Awaited<ReturnType<typeof mkUser>>;
let outsider!: Awaited<ReturnType<typeof mkUser>>;
let projAdmin!: Awaited<ReturnType<typeof mkUser>>;
let ws!: Awaited<ReturnType<typeof mkWorkspace>>;
let pub!: Awaited<ReturnType<typeof mkProject>>;
let priv!: Awaited<ReturnType<typeof mkProject>>;
let priv2!: Awaited<ReturnType<typeof mkProject>>;
const tokenOf = new Map<string, string>();

const access = (fn: (token: string) => Promise<unknown>, user: Awaited<ReturnType<typeof mkUser>>) =>
  fn(tokenOf.get(user.id)!);

beforeAll(async () => {
  [owner, member, guest, outsider, projAdmin] = await Promise.all([
    mkUser({ name: "负责人" }),
    mkUser({ name: "成员" }),
    mkUser({ name: "访客" }),
    mkUser({ name: "路人" }),
    mkUser({ name: "项目管理员" }),
  ]);
  ws = await mkWorkspace(owner.id);
  await addMember(ws.id, member.id, "MEMBER");
  await addMember(ws.id, guest.id, "GUEST");
  await addMember(ws.id, projAdmin.id, "MEMBER");

  pub = await mkProject(ws.id, owner.id); // 公开项目（creator = 项目 ADMIN）
  priv = await mkProject(ws.id, owner.id, { isPrivate: true }); // 私有项目（member 后续加入）
  priv2 = await mkProject(ws.id, owner.id, { isPrivate: true }); // 私有项目（无人加入，排他负锚用）
  // 纯 ProjectRole.ADMIN（非工作区 OWNER）：requireProjectAdmin 放行分支的唯一驱动形态
  const { prisma } = await import("@/lib/prisma");
  await prisma.projectMember.create({
    data: { projectId: pub.id, userId: projAdmin.id, role: "ADMIN" },
  });

  for (const u of [owner, member, guest, outsider, projAdmin]) {
    const { token } = await createApiToken(u.id, { name: "matrix", scopes: ["*"] });
    tokenOf.set(u.id, token);
  }
});

afterAll(cleanupFixtures);

describe("requireWorkspace（工作区成员门槛 + 防枚举）", () => {
  it("成员可见；非成员与不存在的工作区同报 404", async () => {
    const r = await access(
      (t) => requireWorkspace(bearerRequest("GET", "/api/workspaces/x", t), ws.slug),
      member,
    );
    expect((r as { member: { role: string } }).member.role).toBe("MEMBER");

    await expectHttpError(
      access((t) => requireWorkspace(bearerRequest("GET", "/api/workspaces/x", t), ws.slug), outsider),
      404,
    );
    await expectHttpError(
      access((t) => requireWorkspace(bearerRequest("GET", "/api/workspaces/x", t), "no-such-ws"), owner),
      404,
    );
  });

  it("GUEST 亦为工作区成员：门槛放行（角色再按需判定）", async () => {
    const r = await access(
      (t) => requireWorkspace(bearerRequest("GET", "/api/workspaces/x", t), ws.slug),
      guest,
    );
    expect((r as { member: { role: string } }).member.role).toBe("GUEST");
  });

  it("requireWorkspaceAdmin：OWNER 放行，MEMBER 403", async () => {
    const r = await access(
      (t) => requireWorkspaceAdmin(bearerRequest("GET", "/api/workspaces/x", t), ws.slug),
      owner,
    );
    expect((r as { member: { role: string } }).member.role).toBe("OWNER");
    await expectHttpError(
      access((t) => requireWorkspaceAdmin(bearerRequest("GET", "/api/workspaces/x", t), ws.slug), member),
      403,
    );
  });
});

describe("项目可见性（公开 = 工作区成员；私有 = ProjectMember ∪ 工作区 OWNER）", () => {
  it("公开项目：MEMBER 与 GUEST 均可读（锚定 project 身份，防错项目放行）", async () => {
    for (const u of [member, guest]) {
      const r = await access(
        (t) => requireProject(bearerRequest("GET", `/api/projects/${pub.id}`, t), pub.id),
        u,
      );
      expect((r as { project: { id: string } }).project.id).toBe(pub.id);
    }
  });

  it("公开项目：非成员（outsider）404——「公开 = 工作区成员」公式的关键负例", async () => {
    await expectHttpError(
      access((t) => requireProject(bearerRequest("GET", `/api/projects/${pub.id}`, t), pub.id), outsider),
      404,
    );
    // 私有项目对非成员同样 404（且与公开项目同为 404，不泄露存在性）
    await expectHttpError(
      access((t) => requireProject(bearerRequest("GET", `/api/projects/${priv.id}`, t), priv.id), outsider),
      404,
    );
  });

  it("私有项目：普通成员 404（防枚举）；OWNER 可见且视为项目 ADMIN", async () => {
    await expectHttpError(
      access((t) => requireProject(bearerRequest("GET", `/api/projects/${priv.id}`, t), priv.id), member),
      404,
    );
    const r = (await access(
      (t) => requireProject(bearerRequest("GET", `/api/projects/${priv.id}`, t), priv.id),
      owner,
    )) as { projectMemberRole: string | null };
    expect(r.projectMemberRole).toBe("ADMIN");
  });

  it("私有项目：被加入 ProjectMember 后成员可见", async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.projectMember.create({
      data: { projectId: priv.id, userId: member.id, role: "MEMBER" },
    });
    const r = (await access(
      (t) => requireProject(bearerRequest("GET", `/api/projects/${priv.id}`, t), priv.id),
      member,
    )) as { projectMemberRole: string | null };
    expect(r.projectMemberRole).toBe("MEMBER");
  });
});

describe("写权限（GUEST 一律只读，无论层级）", () => {
  it("工作区 GUEST 对公开项目只读 403", async () => {
    await expectHttpError(
      access(
        (t) => requireProjectWrite(bearerRequest("POST", `/api/projects/${pub.id}/issues`, t), pub.id),
        guest,
      ),
      403,
    );
  });

  it("项目级 GUEST 成员同样只读 403", async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.projectMember.create({
      data: { projectId: pub.id, userId: member.id, role: "GUEST" },
    });
    await expectHttpError(
      access(
        (t) => requireProjectWrite(bearerRequest("POST", `/api/projects/${pub.id}/issues`, t), pub.id),
        member,
      ),
      403,
    );
    // 读仍可
    const r = await access(
      (t) => requireProject(bearerRequest("GET", `/api/projects/${pub.id}`, t), pub.id),
      member,
    );
    expect(r).toBeTruthy();
  });

  it("MEMBER 可写公开项目（锚定 project 身份）", async () => {
    const guest2 = await mkUser({ name: "临时成员" });
    await addMember(ws.id, guest2.id, "MEMBER");
    const { token } = await createApiToken(guest2.id, { name: "w", scopes: ["*"] });
    const r = await requireProjectWrite(
      bearerRequest("POST", `/api/projects/${pub.id}/issues`, token),
      pub.id,
    );
    expect((r as { project: { id: string } }).project.id).toBe(pub.id);
  });

  it("OWNER 可写公开项目（写门对 OWNER 的正例）", async () => {
    const r = await access(
      (t) => requireProjectWrite(bearerRequest("POST", `/api/projects/${pub.id}/issues`, t), pub.id),
      owner,
    );
    expect((r as { project: { id: string } }).project.id).toBe(pub.id);
  });

  it("私有项目写门：OWNER 可写；未加入成员写私有项目 404（而非 403——不泄露存在性）", async () => {
    const r = await access(
      (t) => requireProjectWrite(bearerRequest("POST", `/api/projects/${priv.id}/issues`, t), priv.id),
      owner,
    );
    expect((r as { project: { id: string } }).project.id).toBe(priv.id);
    const { prisma } = await import("@/lib/prisma");
    const nonJoiner = await mkUser({ name: "私有项目外人" });
    await addMember(ws.id, nonJoiner.id, "MEMBER");
    const { token } = await createApiToken(nonJoiner.id, { name: "w2", scopes: ["*"] });
    await expectHttpError(
      requireProjectWrite(bearerRequest("POST", `/api/projects/${priv2.id}/issues`, token), priv2.id),
      404,
    );
  });
});

describe("项目管理员门槛（ProjectRole.ADMIN ∨ 工作区 OWNER）", () => {
  it("普通 MEMBER 403；工作区 OWNER 与纯 ProjectRole.ADMIN（非 OWNER）均放行", async () => {
    await expectHttpError(
      access(
        (t) => requireProjectAdmin(bearerRequest("POST", `/api/projects/${pub.id}/states`, t), pub.id),
        member,
      ),
      403,
    );
    const asOwner = await access(
      (t) => requireProjectAdmin(bearerRequest("POST", `/api/projects/${pub.id}/states`, t), pub.id),
      owner,
    );
    expect((asOwner as { project: { id: string } }).project.id).toBe(pub.id);
    // 纯项目 ADMIN 分支（projAdmin 是普通 MEMBER，靠 projectMemberRole==="ADMIN" 放行）
    const asProjAdmin = await access(
      (t) => requireProjectAdmin(bearerRequest("POST", `/api/projects/${pub.id}/states`, t), pub.id),
      projAdmin,
    );
    expect((asProjAdmin as { project: { id: string } }).project.id).toBe(pub.id);
    // 成员列表的 user 画像与 USER_LITE 同口径（含 origin）——listProjectMembers 曾漏该字段
    const pms = await listProjectMembers(pub.id);
    expect(pms.every((m) => m.user && m.user.origin)).toBe(true);
  });

  it("私有项目管理门：OWNER 放行；未加入成员 404", async () => {
    const asOwner = await access(
      (t) => requireProjectAdmin(bearerRequest("POST", `/api/projects/${priv2.id}/states`, t), priv2.id),
      owner,
    );
    expect((asOwner as { project: { id: string } }).project.id).toBe(priv2.id);
    await expectHttpError(
      access(
        (t) => requireProjectAdmin(bearerRequest("POST", `/api/projects/${priv2.id}/states`, t), priv2.id),
        member,
      ),
      404,
    );
  });

  it("不变量：工作区 GUEST 即便被授予项目 ADMIN 仍只读（403 而非放行）", async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.projectMember.create({
      data: { projectId: pub.id, userId: guest.id, role: "ADMIN" },
    });
    await expectHttpError(
      access(
        (t) => requireProjectAdmin(bearerRequest("POST", `/api/projects/${pub.id}/states`, t), pub.id),
        guest,
      ),
      403, // guestReadOnly 先于 admin 判定
    );
  });
});

describe("服务层可见性对齐", () => {
  it("listProjects：OWNER 见全部（含私有），MEMBER 只见公开 + 被加入的私有", async () => {
    const asOwner = await listProjects(ws.id, { userId: owner.id, role: "OWNER" });
    expect(asOwner.some((p) => p.id === priv.id)).toBe(true);

    const asMember = await listProjects(ws.id, { userId: member.id, role: "MEMBER" });
    expect(asMember.some((p) => p.id === pub.id)).toBe(true);
    // member 已在上文被加入私有项目 ProjectMember → 可见
    expect(asMember.some((p) => p.id === priv.id)).toBe(true);
    // 排他负锚：未被加入的私有项目（priv2）不得出现在成员视图——
    // 若可见性过滤整体退化成「返回全部」，此断言红
    expect(asMember.some((p) => p.id === priv2.id)).toBe(false);
  });

  it("listWorkspaceMembers：仅启用户，404 幂等防枚举", async () => {
    const members = await listWorkspaceMembers(ws.slug);
    const ids = members.map((m) => m.user.id);
    expect(ids).toContain(owner.id);
    expect(ids).toContain(guest.id);
    const disabled = await mkUser({ isActive: false });
    await addMember(ws.id, disabled.id, "MEMBER");
    const after = await listWorkspaceMembers(ws.slug);
    expect(after.some((m) => m.user.id === disabled.id)).toBe(false);
    await expectHttpError(listWorkspaceMembers("no-such-ws"), 404);
  });
});
