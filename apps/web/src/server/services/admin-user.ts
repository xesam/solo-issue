import { HttpError } from "@/lib/api";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/server/auth/password";

// 管理台用户服务：
// - 建号：初始密码 + 强制首登改密
// - 停用不删除（Activity 归因外键遍布全库，硬删破坏审计链），停用即吊销全部会话
// - 护栏：最后一个活跃超级管理员 / 工作区最后一个 OWNER 不可被移除

type AdminUserInput = {
  name: string;
  email: string;
  initialPassword: string;
  isAdmin?: boolean;
  memberships?: { wsSlug: string; role: "OWNER" | "MEMBER" | "GUEST" }[];
};

async function assertNotLastActiveAdmin(userId: string) {
  const others = await prisma.user.count({
    where: { isAdmin: true, isActive: true, id: { not: userId } },
  });
  if (others === 0) throw new HttpError(422, "errors.lastActiveAdmin");
}

async function assertNotLastWorkspaceOwner(userId: string, workspaceId: string) {
  const others = await prisma.workspaceMember.count({
    where: { workspaceId, role: "OWNER", user: { isActive: true }, userId: { not: userId } },
  });
  if (others === 0) throw new HttpError(422, "errors.lastWorkspaceOwner");
}

// U3.3：过滤/分页（q=姓名或邮箱模糊；status=活跃/停用；adminOnly；take/skip）
export async function adminListUsers(
  filters: { q?: string; status?: "active" | "disabled"; adminOnly?: boolean; take?: number; skip?: number } = {},
) {
  const where: Prisma.UserWhereInput = {};
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: "insensitive" } },
      { email: { contains: filters.q, mode: "insensitive" } },
    ];
  }
  if (filters.status === "active") where.isActive = true;
  if (filters.status === "disabled") where.isActive = false;
  if (filters.adminOnly) where.isAdmin = true;
  const take = Math.min(filters.take ?? 50, 200);
  const skip = filters.skip ?? 0;
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: {
        workspaceMembers: { include: { workspace: { select: { id: true, slug: true, name: true } } } },
      },
      take,
      skip,
    }),
    prisma.user.count({ where }),
  ]);
  return {
    total,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      origin: u.origin,
      isActive: u.isActive,
      isAdmin: u.isAdmin,
      mustChangePassword: u.mustChangePassword,
      hasPassword: !!u.passwordHash,
      createdAt: u.createdAt,
      memberships: u.workspaceMembers.map((m) => ({
        workspaceId: m.workspace.id,
        wsSlug: m.workspace.slug,
        wsName: m.workspace.name,
        role: m.role,
      })),
    })),
  };
}

export async function adminListWorkspaces() {
  return prisma.workspace.findMany({
    select: { id: true, slug: true, name: true, _count: { select: { members: true, projects: true } } },
    orderBy: { createdAt: "asc" },
  });
}

// ── U2.2：超级管理员的工作区治理 ──

const WS_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

// 工作区方向的成员管理（与用户页「加入工作区」对等）：
// 当前成员 + 可添加候选（活跃且尚未加入的账号）。写操作复用 adminSetWorkspaceRole（含 OWNER 护栏）
export async function adminListWorkspaceMembers(workspaceId: string) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) throw new HttpError(404, "errors.workspaceNotFound");
  const [members, candidates] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true, isActive: true, origin: true } } },
      orderBy: { joinedAt: "asc" },
    }),
    prisma.user.findMany({
      where: { isActive: true, workspaceMembers: { none: { workspaceId } } },
      select: { id: true, name: true, email: true, origin: true, avatarUrl: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    members: members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      origin: m.user.origin,
      isActive: m.user.isActive,
      role: m.role,
    })),
    candidates,
  };
}

export async function adminCreateWorkspace(input: {
  name: string;
  slug: string;
}) {
  if (!WS_SLUG_RE.test(input.slug)) {
    throw new HttpError(422, "errors.wsSlugFormat");
  }
  const exists = await prisma.workspace.findUnique({ where: { slug: input.slug } });
  if (exists) throw new HttpError(422, "errors.slugTaken", undefined, { slug: input.slug });
  return prisma.workspace.create({
    data: { name: input.name.trim(), slug: input.slug },
  });
}

export async function adminRenameWorkspace(workspaceId: string, name: string) {
  return prisma.workspace.update({
    where: { id: workspaceId },
    data: { name: name.trim() },
  });
}

export async function adminCreateUser(input: AdminUserInput) {
  // insensitive 查重（与归一化口径配套）：emailSchema 已 trim+小写，
  // 但存量库可能有历史大小写变体，纯 findUnique 防不住近似撞名
  const exists = await prisma.user.findFirst({
    where: { email: { equals: input.email, mode: "insensitive" } },
  });
  if (exists) throw new HttpError(422, "errors.emailTaken");

  const hash = await hashPassword(input.initialPassword);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        origin: "EMAIL",
        isAdmin: input.isAdmin ?? false,
        passwordHash: hash,
        mustChangePassword: true,
      },
    });
    for (const m of input.memberships ?? []) {
      const ws = await tx.workspace.findUnique({ where: { slug: m.wsSlug } });
      if (!ws) throw new HttpError(422, "errors.wsSlugNotFound", undefined, { slug: m.wsSlug });
      await tx.workspaceMember.create({
        data: { workspaceId: ws.id, userId: user.id, role: m.role },
      });
    }
    return user;
  });
}

export async function adminUpdateUser(
  userId: string,
  input: { name?: string; email?: string | null; isActive?: boolean; isAdmin?: boolean },
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, "errors.userNotFound");

  // 登录键变更（2026-10-22）：改邮箱是账号级凭据操作——不吊销会话（改密吊销的
  // 语义是"旧密码可能外泄"，登录键变更不产生该语义）；IM 建号账号补写 email
  // 即开通密码通道 = 5.5 恢复形态 A（重置密码的 !email 护栏与改密卡片判据自动解除）
  if (input.email !== undefined) {
    if (input.email === null) {
      // 有密码账号清空邮箱 = 密码登录永久不可达（密码按 email 定位），且无自助逃生
      if (user.passwordHash) {
        throw new HttpError(422, "errors.emailClearWithPassword");
      }
    } else {
      const dupe = await prisma.user.findFirst({
        where: { email: { equals: input.email, mode: "insensitive" }, NOT: { id: userId } },
      });
      if (dupe) throw new HttpError(422, "errors.emailTaken");
    }
  }

  // 护栏：降管理员或停用管理员时，必须还有其他活跃管理员。
  // 停用时 isAdmin:true 对已是管理员的用户是 no-op——不能让这个冗余字段使护栏失明
  const stillAdmin = input.isAdmin ?? user.isAdmin;
  const losingAdmin =
    (input.isAdmin === false && user.isAdmin) ||
    (input.isActive === false && stillAdmin);
  if (losingAdmin) await assertNotLastActiveAdmin(userId);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: input });
    if (input.isActive === false) {
      // 停用即吊销全部会话（若同时移除工作区 OWNER 也应留护栏，见 roles）
      await tx.session.deleteMany({ where: { userId } });
    }
  });
}

export async function adminResetPassword(userId: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, "errors.userNotFound");
  // 无邮箱账号（IM 建号，D2）：密码登录按 email 定位，重置出的密码无处兑现（恢复链缺口，5.5）
  if (!user.email) throw new HttpError(422, "errors.userNoEmail");
  const hash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash: hash, mustChangePassword: true },
    });
    await tx.session.deleteMany({ where: { userId } }); // 旧会话全部下线
  });
}

export async function adminSetWorkspaceRole(
  userId: string,
  input: { wsSlug: string; role: "OWNER" | "MEMBER" | "GUEST" | null },
) {
  const ws = await prisma.workspace.findUnique({ where: { slug: input.wsSlug } });
  if (!ws) throw new HttpError(404, "errors.workspaceNotFound");
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new HttpError(404, "errors.userNotFound");
  if (!target.isActive) throw new HttpError(422, "errors.userDisabledEnableFirst");

  const current = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: ws.id, userId } },
  });

  // 护栏：从 OWNER 移走（改角色或退出）时确保还有其他活跃 OWNER
  if (current?.role === "OWNER" && input.role !== "OWNER") {
    await assertNotLastWorkspaceOwner(userId, ws.id);
  }

  if (input.role === null) {
    if (!current) return; // 幂等
    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: ws.id, userId } },
    });
    return;
  }
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: ws.id, userId } },
    update: { role: input.role },
    create: { workspaceId: ws.id, userId, role: input.role },
  });
}
