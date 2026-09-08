import { HttpError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/server/auth/session";
import { verifyApiTokenRequest } from "@/server/auth/token";
import { canWriteWithRoles, isWsOwnerRole, resolveProjectAccess } from "@/server/auth/project-visibility";

// 访问控制：
// - 双通道：会话 Cookie（人类）/ Bearer API Token（Agent，scope 最小授权 + 默认拒绝）
// - 读操作：工作区成员（含 GUEST）；写操作：非 GUEST；工作区管理：OWNER
//   （工作区角色只有 OWNER/MEMBER/GUEST，无独立 ADMIN——负责人权限即"工作区管理"）
// - Agent 权限 = Token scope ∧ 所属用户角色（token 无越权能力）
// 项目级细粒度权限（ProjectMember.projectRole）已启用：写操作 ADMIN/MEMBER，
// 私有项目可见性 = 项目成员 ∪ 工作区 OWNER（见 project-visibility.ts）

export async function requireApiUser(req: Request) {
  const bearer = await verifyApiTokenRequest(req);
  if (bearer) {
    const user = await prisma.user.findUnique({ where: { id: bearer.userId } });
    if (!user) throw new HttpError(401, "errors.tokenOwnerNotFound");
    return user;
  }
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "errors.unauthenticated");
  // 强制改密是承诺过的护栏而非 UI 提示：不加这层，拿着重置前旧会话
  // 直接 curl 业务 API 即可绕过 /change-password 跳转。令牌通道不受影响——
  // mustChangePassword 针对的是"初始/临时密码可能外泄"，与令牌凭证无关
  if (user.mustChangePassword)
    throw new HttpError(403, "errors.mustChangePassword");
  return user;
}

/** 超级管理员：仅解锁管理台（用户/配置），不自动属于任何工作区、不穿透业务数据 */
export async function requireInstanceAdmin(req: Request) {
  const user = await requireApiUser(req);
  if (!user.isAdmin) throw new HttpError(403, "errors.instanceAdminRequired");
  return user;
}

export async function requireWorkspace(req: Request, wsSlug: string) {
  const user = await requireApiUser(req);
  const workspace = await prisma.workspace.findUnique({
    where: { slug: wsSlug },
  });
  if (!workspace) throw new HttpError(404, "errors.workspaceNotFound");
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
  });
  // 404 语义（防枚举）：非成员与“不存在”不可区分——与 requireProject 一致
  if (!member) throw new HttpError(404, "errors.workspaceNotFound");
  return { user, workspace, member };
}

/** 工作区负责人（OWNER）：建项目等工作区级操作 */
export async function requireWorkspaceAdmin(req: Request, wsSlug: string) {
  const { user, workspace, member } = await requireWorkspace(req, wsSlug);
  if (member.role !== "OWNER") throw new HttpError(403, "errors.workspaceOwnerRequired");
  return { user, workspace, member };
}

export async function requireProject(req: Request, projectId: string) {
  const user = await requireApiUser(req);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) throw new HttpError(404, "errors.projectNotFound");
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: project.workspaceId, userId: user.id } },
  });
  // 私有项目：非工作区负责人的成员需在 ProjectMember 列表中
  const access = await resolveProjectAccess(user.id, project, member?.role ?? null);
  // 404 语义（防枚举）：不可见即不存在（私有项目对非可见成员与已删项目不可区分）
  if (!access) throw new HttpError(404, "errors.projectNotFound");
  return { user, project, member: member!, projectMemberRole: access.projectMemberRole };
}

/** 项目写操作：GUEST 不论在哪个层级（工作区/项目成员）一律只读；其余可写 */
export async function requireProjectWrite(req: Request, projectId: string) {
  const { user, project, member, projectMemberRole } = await requireProject(req, projectId);
  if (!canWriteWithRoles(member.role, projectMemberRole))
    throw new HttpError(403, "errors.guestReadOnly");
  return { user, project, member, projectMemberRole };
}

/**
 * 项目管理操作（设置/成员管理/字段定义/删除等）：项目负责人（ProjectRole.ADMIN）∨ 工作区负责人（OWNER）。
 * 授权判定在各管理路径统一（字段管理起用 ProjectRole 判定；删除等破坏性操作同判定）。
 * 先过 GUEST 只读不变量：工作区 GUEST 即便被授予项目角色也只读（与 canWriteWithRoles 同口径），
 * 否则"给 GUEST 发项目 ADMIN"即可绕过全站只读承诺。
 */
export async function requireProjectAdmin(req: Request, projectId: string) {
  const { user, project, member, projectMemberRole } = await requireProject(req, projectId);
  if (!canWriteWithRoles(member.role, projectMemberRole))
    throw new HttpError(403, "errors.guestReadOnly");
  const wsAdmin = isWsOwnerRole(member.role);
  const projectAdmin = projectMemberRole === "ADMIN";
  if (!wsAdmin && !projectAdmin) throw new HttpError(403, "errors.projectAdminRequired");
  return { user, project, member, projectMemberRole };
}

