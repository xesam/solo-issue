import { HttpError } from "@/lib/api";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TimeCursor } from "@/lib/api";

// ── 统一时间线（v1 合并流）──
// 评论 + 活动按 (createdAt, id) 元组序混排成一条流，右栏对话面板消费。
// 分页沿用复合游标：跨表统一用 (createdAt, id) 元组比较——
// 两表 id 皆为 cuid，元组序全序且确定，跨表不重不漏；
// 同毫秒边界条目顺序由 id 字典序决定（与单表评论分页同语义）。
// 旧 /comments、/activities 端点保留（Agent 面与存量消费方兼容），本端点是详情页的新事实源。

const TIMELINE_PAGE = 50;

// 复合查询形态：kind 判别后前端按类型分支渲染（评论卡片强调 / 活动小字弱化）
type TimelineItem =
  | {
      kind: "comment";
      id: string;
      createdAt: Date;
      author: { id: string; name: string; email: string | null; avatarUrl: string | null; origin: string };
      body: unknown; // Tiptap 文档
    }
  | {
      kind: "activity";
      id: string;
      createdAt: Date;
      actor: { id: string; name: string; email: string | null; avatarUrl: string | null; origin: string } | null;
      action: string;
      field: string | null;
      oldValue: unknown; // Json 列，渲染前 String() 归一
      newValue: unknown;
    };

const USER_SELECT = { id: true, name: true, email: true, avatarUrl: true, origin: true } as const;

export async function listTimeline(
  projectId: string,
  number: number,
  cursor?: TimeCursor,
) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number } },
    select: { id: true },
  });
  if (!issue) throw new HttpError(404, "errors.issueNotFound");

  const idScope = { issueId: issue.id };
  // 合并流去重：评论已有卡片形态，其同步写入的 COMMENTED 活动不再重复展示
  // （/activities 端点不受影响，Agent 面仍可看到全量）
  const actScope: Prisma.ActivityWhereInput = {
    issueId: issue.id,
    action: { not: "COMMENTED" },
  };
  const cursorWhere = cursor
    ? {
        OR: [
          { createdAt: { lt: cursor.before } },
          { createdAt: cursor.before, id: { lt: cursor.beforeId } },
        ],
      }
    : {};
  // 多取 1 条探测 hasMore（合并后按元组序裁剪，两表各取 PAGE+1 上限足够）
  const [comments, activities, commentTotal, activityTotal] = await Promise.all([
    prisma.comment.findMany({
      where: { ...idScope, isDeleted: false, ...cursorWhere },
      include: { author: { select: USER_SELECT } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TIMELINE_PAGE + 1,
    }),
    prisma.activity.findMany({
      where: { ...actScope, ...cursorWhere },
      include: { actor: { select: USER_SELECT } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TIMELINE_PAGE + 1,
    }),
    prisma.comment.count({ where: { ...idScope, isDeleted: false } }),
    prisma.activity.count({ where: actScope }),
  ]);

  const merged = [
    ...comments.map<TimelineItem>((c) => ({
      kind: "comment",
      id: c.id,
      createdAt: c.createdAt,
      author: c.author,
      body: c.body,
    })),
    ...activities.map<TimelineItem>((a) => ({
      kind: "activity",
      id: a.id,
      createdAt: a.createdAt,
      actor: a.actor,
      action: a.action,
      field: a.field,
      oldValue: a.oldValue,
      newValue: a.newValue,
    })),
  ].sort((x, y) =>
    y.createdAt.getTime() - x.createdAt.getTime() || (y.id < x.id ? -1 : y.id > x.id ? 1 : 0),
  );

  const hasMore = merged.length > TIMELINE_PAGE;
  const page = (hasMore ? merged.slice(0, TIMELINE_PAGE) : merged).reverse(); // 展示序：旧→新
  return { items: page, hasMore, total: commentTotal + activityTotal };
}
