import { HttpError } from "@/lib/api";
import { docToMentions, docToText } from "@/lib/tiptap-text";
import { prisma } from "@/lib/prisma";
import { dispatchIm, emitNotifications, recordTranslator, type NotifyItem } from "./notification";
import type { TimeCursor } from "@/lib/api";
import type { Prisma } from "@prisma/client";

// author select 与 dto.ts USER_LITE / TimelineItemDTO 口径一致（含 origin——类型承诺的字段运行时必须有值）
const COMMENT_AUTHOR_INCLUDE = {
  author: { select: { id: true, name: true, email: true, avatarUrl: true, origin: true } },
} satisfies Prisma.CommentInclude;

type CommentWithAuthor = Prisma.CommentGetPayload<{
  include: typeof COMMENT_AUTHOR_INCLUDE;
}>;

// 评论：正文为 Tiptap 文档，bodyText 服务端派生；评论即活动（COMMENTED）
// 通知：关注者（负责人 ∪ 创建人 ∪ 此前评论者）得 COMMENTED，
//       被提及者得 MENTIONED（不重复收 COMMENTED）

// 评论时间线不全量返回（载荷为 Tiptap JSON，重量随条数线性涨）。
// 默认最近 COMMENTS_PAGE 条，更早的用复合游标分批拉；评论总数单独 count 供标题展示。
const COMMENTS_PAGE = 50;

export async function listComments(
  projectId: string,
  number: number,
  cursor?: TimeCursor,
) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number } },
    select: { id: true },
  });
  if (!issue) throw new HttpError(404, "errors.issueNotFound");
  const scope = { issueId: issue.id, isDeleted: false };
  const [rows, total] = await Promise.all([
    prisma.comment.findMany({
      where: {
        ...scope,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.before } },
                { createdAt: cursor.before, id: { lt: cursor.beforeId } },
              ],
            }
          : {}),
      },
      include: COMMENT_AUTHOR_INCLUDE, // 单源常量：手写字面量曾漏 origin（写select/读include 双份观察同形）
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: COMMENTS_PAGE + 1, // 多取 1 条探测 hasMore
    }),
    prisma.comment.count({ where: scope }),
  ]);
  const hasMore = rows.length > COMMENTS_PAGE;
  const page = (hasMore ? rows.slice(0, COMMENTS_PAGE) : rows).reverse(); // 展示序：旧→新
  return { comments: page, hasMore, total };
}

export async function createComment(
  projectId: string,
  number: number,
  body: Record<string, unknown>,
  actor: { id: string; name: string },
) {
  const bodyText = docToText(body as never);
  if (!bodyText.trim()) throw new HttpError(422, "errors.commentBodyRequired");

  const notificationIds: string[] = [];
  let saved: CommentWithAuthor | null = null;
  // 通知标题在触发动作的用户 locale 下渲染落库（站内/推送共用同一事实源）
  const t = await recordTranslator();
  await prisma.$transaction(async (tx) => {
    const issue = await tx.issue.findUnique({
      where: { projectId_number: { projectId, number } },
      select: { id: true, title: true, createdById: true, assignees: { select: { userId: true } } },
    });
    if (!issue) throw new HttpError(404, "errors.issueNotFound");

    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { workspace: true },
    });
    if (!project) throw new HttpError(404, "errors.projectNotFound");

    // 此前评论者——须在写入当前评论前查询（否则会把刚发的这条也算进来）
    const mentioned = docToMentions(body as never);
    const previousCommenters = await tx.comment.findMany({
      where: { issueId: issue.id, isDeleted: false },
      distinct: ["authorId"],
      select: { authorId: true },
    });

    const comment = await tx.comment.create({
      data: {
        issueId: issue.id,
        authorId: actor.id,
        body: body as never,
        bodyText,
      },
      include: COMMENT_AUTHOR_INCLUDE,
    });

    const act = await tx.activity.create({
      data: {
        issueId: issue.id,
        projectId,
        actorId: actor.id,
        action: "COMMENTED",
        commentId: comment.id,
        field: "comment",
        newValue: bodyText.slice(0, 80),
      },
    });

    // ── 通知计划 ──
    const ref = `${project.slug.toUpperCase()}-${number}`;
    const issueUrl = `/w/${project.workspace.slug}/p/${project.slug}/issues/${number}`;
    const snippet = bodyText.slice(0, 80);

    const items: NotifyItem[] = [
      {
        type: "COMMENTED",
        userIds: [
          ...new Set([
            ...issue.assignees.map((a) => a.userId),
            issue.createdById,
            ...previousCommenters.map((c) => c.authorId),
          ]),
        ].filter((id) => !mentioned.has(id)),
        activityId: act.id,
        title: t("im.instance.commented", { project: project.name, actor: actor.name, ref }),
        body: snippet,
      },
    ];
    if (mentioned.size) {
      items.push({
        type: "MENTIONED",
        userIds: [...mentioned],
        activityId: act.id,
        title: t("im.instance.mentioned", { project: project.name, actor: actor.name, ref }),
        body: snippet,
      });
    }

    saved = comment;
    notificationIds.push(
      ...(await emitNotifications(tx, {
        projectId,
        issueId: issue.id,
        issueUrl,
        actorId: actor.id,
        items,
      })),
    );
  });

  await dispatchIm(notificationIds);
  return saved!;
}
