import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { USER_LITE } from "@/lib/dto";
import { crossWorkspaceProjectVisibility } from "@/server/auth/project-visibility";
import type { TimeCursor } from "@/lib/api";

// 个人工作台：跨项目聚合（待我处理/我创建；通知独立成 tab，见 Workbench.tsx）
// 可见性：复用 crossWorkspaceProjectVisibility（私有项目全链路过滤）

export type WorkbenchTab = "assigned" | "created";

export const WORKBENCH_TABS: WorkbenchTab[] = ["assigned", "created"];

// 时间线复合游标分批拉（同评论/通知），取代静默截断——
// 那时 stats 徽标（无上限 count）与列表可见数已经错位，现在加载更早可拉全
const WORKBENCH_PAGE = 50;

// "未完成" = 无状态，或状态分组不在 已完成/已取消（语义分组是关键，而非状态名）
const OPEN_CONDITION: Prisma.IssueWhereInput = {
  OR: [{ state: null }, { state: { group: { notIn: ["COMPLETED", "CANCELLED"] } } }],
};

const ISSUE_WB_INCLUDE: Prisma.IssueInclude = {
  state: true,
  assignees: { include: { user: { select: USER_LITE } } },
  project: {
    select: {
      id: true,
      slug: true,
      name: true,
      workspace: { select: { slug: true, name: true } },
    },
  },
};

type WorkbenchIssue = Prisma.IssueGetPayload<{ include: typeof ISSUE_WB_INCLUDE }>;

export async function getWorkbench(
  userId: string,
  tab: WorkbenchTab,
  cursor?: TimeCursor,
  wsSlug?: string,
) {
  let memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    select: { workspaceId: true, role: true },
  });

  // ?ws=<slug> 收窄到单一工作区（非成员/不存在 → 空结果，不泄露存在性）
  if (wsSlug) {
    const ws = await prisma.workspace.findUnique({
      where: { slug: wsSlug },
      select: { id: true },
    });
    memberships = memberships.filter((m) => m.workspaceId === ws?.id);
  }

  const wsIds = memberships.map((m) => m.workspaceId);

  // 无任何工作区：返回空（不抛错，登录引导层处理）
  if (!wsIds.length) {
    return {
      issues: [] as WorkbenchIssue[],
      stats: { assigned: 0, created: 0 },
      hasMore: false,
      nextCursor: null,
    };
  }

  const visibility = await crossWorkspaceProjectVisibility(userId, memberships);
  const projectFilter: Prisma.ProjectWhereInput = {
    workspaceId: { in: wsIds },
    ...(visibility as object),
  };

  const assignedWhere: Prisma.IssueWhereInput = {
    isArchived: false,
    project: projectFilter,
    assignees: { some: { userId } },
    ...OPEN_CONDITION,
  };
  const createdWhere: Prisma.IssueWhereInput = {
    isArchived: false,
    project: projectFilter,
    createdById: userId,
  };

  let issues: WorkbenchIssue[];
  let hasMore = false;
  let nextCursor: TimeCursor | null = null;

  // 原"提及我"分支已删（它只是 MENTIONED 通知的工单级折叠视图，
  // 由工作台"通知" tab 的提及筛选 chips 取代）。
  // 游标条件不能直接摊进 where：assignedWhere 自带 OR（OPEN_CONDITION），
  // 同层 OR 会互相覆盖——用 AND 嵌套两条件
  const base = tab === "assigned" ? assignedWhere : createdWhere;
  const rows = await prisma.issue.findMany({
    where: cursor
      ? {
          AND: [
            base,
            {
              OR: [
                { updatedAt: { lt: cursor.before } },
                { updatedAt: cursor.before, id: { lt: cursor.beforeId } },
              ],
            },
          ],
        }
      : base,
    include: ISSUE_WB_INCLUDE,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: WORKBENCH_PAGE + 1,
  });
  hasMore = rows.length > WORKBENCH_PAGE;
  const page = hasMore ? rows.slice(0, WORKBENCH_PAGE) : rows;
  issues = page;
  // 最后一页不再提供游标（否则 hasMore=false 还带 nextCursor，消费方无所适从）
  if (hasMore) {
    const last = page[page.length - 1];
    nextCursor = { before: last.updatedAt, beforeId: last.id };
  }

  const [assigned, created] = await Promise.all([
    prisma.issue.count({ where: assignedWhere }),
    prisma.issue.count({ where: createdWhere }),
  ]);

  return {
    issues,
    stats: { assigned, created },
    hasMore,
    nextCursor,
  };
}
