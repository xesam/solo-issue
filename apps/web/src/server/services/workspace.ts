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
