import { HttpError } from "@/lib/api";
import { USER_LITE } from "@/lib/dto";
import { prisma } from "@/lib/prisma";

export async function listMyWorkspaces(userId: string) {
  return prisma.workspaceMember.findMany({
    where: { userId },
    include: {
      workspace: { include: { _count: { select: { projects: true } } } },
    },
    orderBy: { joinedAt: "asc" },
  });
}

/** /api/auth/me 与 /api/me 共用的所属工作区摘要（身份回吐 payload 的单一事实源） */
export async function listMyWorkspaceSummaries(userId: string) {
  const memberships = await listMyWorkspaces(userId);
  return memberships.map((m) => ({
    role: m.role,
    workspace: {
      id: m.workspace.id,
      slug: m.workspace.slug,
      name: m.workspace.name,
      projectCount: m.workspace._count.projects,
    },
  }));
}

export async function listWorkspaceMembers(wsSlug: string) {
  const workspace = await prisma.workspace.findUnique({ where: { slug: wsSlug } });
  if (!workspace) throw new HttpError(404, "errors.workspaceNotFound");
  // 负责人选择器数据源：仅启用用户，与服务端指派校验（assertUsersVisible）对齐，
  // 避免停用用户出现在候选里却被 422 拒绝
  return prisma.workspaceMember.findMany({
    where: { workspaceId: workspace.id, user: { isActive: true } },
    include: { user: { select: USER_LITE } },
    orderBy: [{ user: { name: "asc" } }],
  });
}
