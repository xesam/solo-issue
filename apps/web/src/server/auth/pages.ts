// 服务端页面/布局共用的上下文解析：未登录跳登录页，无权限 404
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/server/auth/session";
import { resolveProjectAccess } from "@/server/auth/project-visibility";

export async function pageContext(wsSlug: string) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (user.mustChangePassword) redirect("/change-password");
  const workspace = await prisma.workspace.findUnique({ where: { slug: wsSlug } });
  if (!workspace) notFound();
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
  });
  if (!member) notFound();
  return { user, workspace, member };
}

// 账号层（/me）页面/布局的上下文：不绑定任何工作区，返回该用户的全部工作区（joinedAt 序）
export async function getUserContext() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (user.mustChangePassword) redirect("/change-password");
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    orderBy: { joinedAt: "asc" },
    select: { workspace: { select: { slug: true, name: true } } },
  });
  return { user, workspaces: memberships.map((m) => m.workspace) };
}

export async function pageProject(wsSlug: string, projectSlug: string) {
  const ctx = await pageContext(wsSlug);
  const project = await prisma.project.findUnique({
    where: { workspaceId_slug: { workspaceId: ctx.workspace.id, slug: projectSlug } },
  });
  if (!project) notFound();
  // 私有项目可见性：不可见 = 404（不泄露项目存在）
  const access = await resolveProjectAccess(ctx.user.id, project, ctx.member.role);
  if (!access) notFound();
  return { ...ctx, project, projectMemberRole: access.projectMemberRole };
}
