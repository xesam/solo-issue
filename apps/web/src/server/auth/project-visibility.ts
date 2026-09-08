import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// 私有项目可见性：
// 可见 = 公开项目 ∪（私有 ∧（ProjectMember ∨ 工作区负责人 OWNER））
// 写   = 可见 ∧ 非访客（工作区 GUEST 或项目级 GUEST 成员——公开/私有项目均只读）

/** 工作区负责人（OWNER）——在项目层面享有 ADMIN 判定（见 resolveProjectAccess） */
export function isWsOwnerRole(role: string) {
  return role === "OWNER";
}

/** 用户可见的私有项目 id 集合 */
async function visiblePrivateProjectIds(userId: string): Promise<string[]> {
  const rows = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true },
  });
  return rows.map((r) => r.projectId);
}

/** 跨工作区场景（全局搜索/工作台）：完整可见性条件（不含工作区边界，调用方先交 wsIds） */
export async function crossWorkspaceProjectVisibility(
  userId: string,
  wsMemberRoles: { workspaceId: string; role: string }[],
): Promise<Prisma.ProjectWhereInput> {
  const adminWsIds = wsMemberRoles.filter((m) => isWsOwnerRole(m.role)).map((m) => m.workspaceId);
  const visiblePrivate = await visiblePrivateProjectIds(userId);
  const or: Prisma.ProjectWhereInput[] = [
    { isPrivate: false },
    ...(adminWsIds.length ? [{ workspaceId: { in: adminWsIds } }] : []),
    ...(visiblePrivate.length ? [{ id: { in: visiblePrivate } }] : []),
  ];
  return { OR: or };
}

/** 单项目访问判定：返回 null = 不可见 */
export async function resolveProjectAccess(
  userId: string,
  project: { id: string; workspaceId: string; isPrivate: boolean },
  wsMemberRole: string | null,
) {
  if (wsMemberRole === null) return null;
  // 公开项目：可见性只靠工作区成员；但项目级角色（用于字段管理）仍要读取
  if (!project.isPrivate) return { projectMemberRole: await projectRoleOf(project.id, userId) };
  if (isWsOwnerRole(wsMemberRole)) return { projectMemberRole: "ADMIN" };
  const role = await projectRoleOf(project.id, userId);
  if (!role) return null;
  return { projectMemberRole: role };
}

async function projectRoleOf(projectId: string, userId: string) {
  const pm = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  return pm?.role ?? null;
}

/** 可见 ∧ 可写？（访客只读） */
export function canWriteWithRoles(wsMemberRole: string, projectMemberRole: string | null) {
  if (wsMemberRole === "GUEST") return false;
  if (projectMemberRole === "GUEST") return false;
  return true;
}
