import { HttpError } from "@/lib/api";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isWsOwnerRole } from "@/server/auth/project-visibility";

// 新项目自动创建的默认状态（语义分组借鉴 Plane 的验证设计）
export const DEFAULT_STATES = [
  { name: "待梳理", color: "#64748b", sequence: 15000, group: "ACTIVE" as const, isDefault: true },
  { name: "待办", color: "#64748b", sequence: 25000, group: "ACTIVE" as const, isDefault: false },
  { name: "进行中", color: "#f59e0b", sequence: 35000, group: "ACTIVE" as const, isDefault: false },
  { name: "已完成", color: "#22a559", sequence: 45000, group: "COMPLETED" as const, isDefault: false },
  { name: "已取消", color: "#94a3b8", sequence: 55000, group: "CANCELLED" as const, isDefault: false },
];

export async function listProjects(
  workspaceId: string,
  viewer?: { userId: string; role: string },
) {
  // 私有项目可见性过滤（私有项目可见性）；未传 viewer = 内部调用（信任）
  let where: Prisma.ProjectWhereInput = { workspaceId };
  if (viewer && !isWsOwnerRole(viewer.role)) {
    const privateVisible = await prisma.projectMember.findMany({
      where: { userId: viewer.userId, project: { workspaceId } },
      select: { projectId: true },
    });
    where = {
      workspaceId,
      OR: [
        { isPrivate: false },
        { id: { in: privateVisible.map((m) => m.projectId) } },
      ],
    };
  }
  // U3.6：最新活动时间（一次 groupBy 拿全工作区各项目的 max，避免 N+1）
  const projects = await prisma.project.findMany({
    where,
    include: {
      _count: { select: { issues: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const latestList = await prisma.activity.groupBy({
    by: ["projectId"],
    where: { projectId: { in: projects.map((p) => p.id) } },
    _max: { createdAt: true },
  });
  const latestMap = new Map(
    latestList.map((r) => [r.projectId, r._max.createdAt?.toISOString() ?? null]),
  );
  return projects.map((p) => ({
    ...p,
    latestActivityAt: latestMap.get(p.id) ?? null,
  }));
}

// U2.3：删除项目——护栏：仅项目 ADMIN 且 0 问题才允许
// （State/ProjectMember/IssueView/CustomField 均级联）；防误删：前端二次确认需输入 slug
export async function deleteProject(projectId: string) {
  const issueCount = await prisma.issue.count({ where: { projectId } });
  if (issueCount > 0) {
    throw new HttpError(422, "errors.projectHasIssues", undefined, { count: issueCount });
  }
  await prisma.project.delete({ where: { id: projectId } });
}

export async function getProjectById(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new HttpError(404, "errors.projectNotFound");
  return project;
}

export async function createProject(
  workspaceId: string,
  input: { name: string; slug?: string; isPrivate?: boolean },
  actorId: string,
) {
  const slug =
    input.slug ??
    `p-${Math.random().toString(36).slice(2, 8)}`; // 未指定时生成短 slug（中文名不做拼音转换）
  const exists = await prisma.project.findUnique({
    where: { workspaceId_slug: { workspaceId, slug } },
  });
  if (exists) throw new HttpError(409, "errors.slugTaken", undefined, { slug });

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        workspaceId,
        slug,
        name: input.name,
        isPrivate: input.isPrivate ?? false,
      },
    });
    await tx.state.createMany({
      data: DEFAULT_STATES.map((s) => ({
        projectId: project.id,
        name: s.name,
        color: s.color,
        sequence: s.sequence,
        group: s.group,
        isDefault: s.isDefault,
      })),
    });
    // 创建者自动成为项目 ADMIN（私有项目的可见性兜底）
    await tx.projectMember.create({
      data: { projectId: project.id, userId: actorId, role: "ADMIN" },
    });
    return project;
  });
}

export async function updateProject(
  projectId: string,
  input: { name?: string; isArchived?: boolean; isPrivate?: boolean },
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new HttpError(404, "errors.projectNotFound");
  return prisma.project.update({ where: { id: projectId }, data: input });
}

// ── 私有项目成员管理（项目 ADMIN 或工作区 OWNER 通过项目设置操作）──

export async function listProjectMembers(projectId: string) {
  return prisma.projectMember.findMany({
    where: { projectId },
    // user select 与 USER_LITE 口径一致（含 origin）——MemberDTO 类型承诺的字段运行时必须有值
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true, origin: true } } },
    orderBy: { user: { name: "asc" } },
  });
}

export async function upsertProjectMember(
  projectId: string,
  userId: string,
  role: "ADMIN" | "MEMBER" | "GUEST",
) {
  await prisma.projectMember.upsert({
    where: { projectId_userId: { projectId, userId } },
    update: { role },
    create: { projectId, userId, role },
  });
}

export async function removeProjectMember(projectId: string, userId: string) {
  // 只吞"本来就不存在"（幂等删除）；其余 DB 错误必须上抛，否则删除失败也返回 200
  await prisma.projectMember
    .delete({ where: { projectId_userId: { projectId, userId } } })
    .catch((e) => {
      if (e?.code !== "P2025") throw e;
    });
}
