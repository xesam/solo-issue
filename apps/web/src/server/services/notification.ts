import type { Prisma, NotificationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isWsOwnerRole } from "@/server/auth/project-visibility";
import { IM_SEND_QUEUE, getBoss } from "@/server/queue";
import { resolveRequestLocale, translatorFor } from "@/i18n/server";

// 通知引擎（M4 核心）：
// 1) 业务事务内 emitNotifications()：过滤成员资格/排除本人 → 写站内通知
// 2) 事务提交后 dispatchIm()：把通知入队 pg-boss（轻量，失败仅影响 IM 推送）
// 3) worker 消费：按偏好过滤 → 查 Identity → 企微通道推送
//    （real: textcard / mock: 模拟收件箱）
//
// 偏好结构（JSONB）：{ ASSIGNED: { wecom: true }, ... }，缺省全开；
// 项目级行覆盖全局行（同键逐项覆盖）。站内通知始终记录（事实源/收件箱）。

export const NOTIFICATION_TYPES: NotificationType[] = [
  "ASSIGNED",
  "MENTIONED",
  "COMMENTED",
  "STATE_CHANGED",
];



export interface NotifyItem {
  type: NotificationType;
  userIds: string[];
  activityId: string;
  title: string;
  body?: string;
}

type Tx = Prisma.TransactionClient;

/**
 * 用户对某项目的生效偏好（项目行覆盖全局行；缺省全开）。
 * projectId 为 null（或 issue 不挂项目，如站内信）时只读全局行——
 * 直接短路，不再让调用方发明"保证查不到的魔法项目 id"。
 */
export async function resolvePrefs(
  userId: string,
  projectId: string | null,
): Promise<Record<string, { wecom: boolean }>> {
  const [global, projectRow] = await Promise.all([
    prisma.notificationPreference.findFirst({ where: { userId, projectId: null } }),
    projectId === null
      ? Promise.resolve(null)
      : prisma.notificationPreference.findFirst({ where: { userId, projectId } }),
  ]);

  const effective: Record<string, { wecom: boolean }> = {};
  for (const type of NOTIFICATION_TYPES) effective[type] = { wecom: true };

  const apply = (prefs: unknown) => {
    const p = (prefs ?? {}) as Record<string, Record<string, boolean> | undefined>;
    for (const type of NOTIFICATION_TYPES) {
      const v = p[type]?.wecom;
      if (v !== undefined) effective[type].wecom = v;
    }
  };
  apply(global?.prefs);
  if (projectRow) apply(projectRow.prefs);
  return effective;
}

/**
 * 事务内：写站内通知并返回通知 id 列表
 * - 接收人必须是该工作区有效成员（防伪造 mention id 越权送达）
 * - 私有项目额外要求接收人当前对该项目可见（ProjectMember ∨ 工作区负责人）——
 *   防止“被移出私有项目但仍在工作区”的历史关注者继续收到含标题/摘要的通知（信息泄漏）
 * - 排除操作者本人；同一 (用户, 活动, 类型) 去重
 */
export async function emitNotifications(
  tx: Tx,
  params: {
    projectId: string;
    issueId: string;
    issueUrl: string;
    actorId: string;
    items: NotifyItem[];
  },
): Promise<string[]> {
  const { projectId, issueId, issueUrl, actorId, items } = params;

  const candidates = new Set<string>();
  for (const item of items) item.userIds.forEach((id) => candidates.add(id));
  candidates.delete(actorId);
  if (candidates.size === 0) return [];

  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { workspaceId: true, isPrivate: true },
  });
  if (!project) return []; // projectId 必属同一事务内已验证的 issue/project，防御留白处理
  const members = await tx.workspaceMember.findMany({
    where: {
      workspaceId: project.workspaceId,
      userId: { in: [...candidates] },
      user: { isActive: true },
    },
    select: { userId: true, role: true },
  });
  let memberIds = new Set(members.map((m) => m.userId));

  // 私有项目：可见 = ProjectMember ∨ 工作区负责人（与 resolveProjectAccess 同口径）
  if (project.isPrivate) {
    const pms = await tx.projectMember.findMany({
      where: { projectId, userId: { in: [...memberIds] } },
      select: { userId: true },
    });
    const visible = new Set([
      ...members.filter((m) => isWsOwnerRole(m.role)).map((m) => m.userId),
      ...pms.map((m) => m.userId),
    ]);
    memberIds = new Set([...memberIds].filter((id) => visible.has(id)));
  }

  const ids: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    for (const userId of item.userIds) {
      if (userId === actorId || !memberIds.has(userId)) continue;
      const key = `${userId}:${item.activityId}:${item.type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const n = await tx.notification.create({
          data: {
            userId,
            issueId,
            projectId,
            activityId: item.activityId,
            type: item.type,
            title: item.title.slice(0, 100),
            body: (item.body ?? "").slice(0, 300),
            url: issueUrl,
          },
          select: { id: true },
        });
        ids.push(n.id);
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") continue; // 并发重复，跳过
        throw e;
      }
    }
  }
  return ids;
}

/** 记录级渲染 locale：请求内取请求 locale；scripts 直调（无请求作用域）兜底英文 */
async function recordLocale() {
  try {
    return await resolveRequestLocale();
  } catch {
    return "en" as const;
  }
}

/**
 * 记录级文案翻译器（通知标题、导入跳过原因等落库/入响应文案）。
 * = requestTranslator + 非请求上下文兜底英文（verify-custom-fields 等 scripts 直调服务时触发兜底）。
 */
export async function recordTranslator() {
  return translatorFor(await recordLocale());
}

/** 事务提交后：通知入队（worker 做偏好过滤与推送）。失败不影响主流程 */
export async function dispatchIm(notificationIds: string[]): Promise<void> {
  if (!notificationIds.length) return;
  try {
    // locale 快照进 payload：worker 无请求上下文，按入队时刻的请求 locale 渲染兜底文案
    const locale = await recordLocale();
    const boss = await getBoss();
    await boss.send(
      IM_SEND_QUEUE,
      { notificationIds, locale },
      { retryLimit: 3, retryBackoff: true },
    );
  } catch (e) {
    console.error("[notify] IM 入队失败（站内通知不受影响）:", e);
  }
}
