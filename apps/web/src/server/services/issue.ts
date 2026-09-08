import type { Prisma, State } from "@prisma/client";
import { HttpError } from "@/lib/api";
import { ISSUE_INCLUDE, type IssueFilters, type UserLite } from "@/lib/dto";
import { prisma } from "@/lib/prisma";
import { docToMentions, docToText } from "@/lib/tiptap-text";
import { jsonEqual } from "@/lib/utils";
import { dispatchIm, emitNotifications, recordTranslator, type NotifyItem } from "./notification";
import { deleteFile } from "@/server/storage";
import { activeFieldsFor } from "./custom-field";
import {
  fieldText,
  selectOrUserMultiple,
  userFieldIdentifiers,
  userIdsOfFieldValue,
  validateFieldValues,
} from "@/server/custom-fields/registry";
import {
  NOTIFY_FIELD_USERS,
  NOTIFY_PROJECT_LEAD,
  type NotifyRule,
  notifyRuleFor,
} from "@/server/custom-fields/notify-rules";
import type { createIssueSchema, updateIssueSchema } from "@/lib/validations";
import type { z } from "zod";

type CreateIssueInput = z.infer<typeof createIssueSchema>;
type UpdateIssueInput = z.infer<typeof updateIssueSchema>;

type Actor = { id: string; name: string };

// 字段级通知规则钩子在 updateIssue 尾段；DSL 唯一定义点见 src/server/custom-fields/notify-rules.ts

async function notifyRecipients(
  tx: Prisma.TransactionClient,
  project: { id: string; leadUserId: string | null },
  fields: { key: string; type: string }[],
  merged: Record<string, unknown>,
  rule: NotifyRule,
): Promise<string[]> {
  const out = new Set<string>();
  for (const target of rule.notify) {
    if (target === NOTIFY_PROJECT_LEAD) {
      if (project.leadUserId) out.add(project.leadUserId);
    } else if (target === NOTIFY_FIELD_USERS) {
      for (const f of fields)
        if (f.type === "USER")
          for (const id of userIdsOfFieldValue(merged[f.key])) out.add(id);
    }
  }
  return [...out];
}

/**
 * 通知标题里的字段值展示文案。
 * USER 类型存的是 userId，`fieldText` 无从解析姓名，故在此批量查名后替换；
 * 查不到的 id 回退原值（不因用户被删而报错或显示空白）。
 */
async function fieldTextForNotification(
  tx: Prisma.TransactionClient,
  field: { key: string; type: string } & Parameters<typeof fieldText>[0],
  value: unknown,
): Promise<string> {
  if (field.type !== "USER") return fieldText(field, value);
  const ids = userIdsOfFieldValue(value);
  if (!ids.length) return fieldText(field, value);
  const users = await tx.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return ids.map((id) => nameOf.get(id) ?? id).join(", ");
}

// ── 列表 ──

// 页码式分页 + 过滤/排序 SQL 化。
// 排序键收缩为 createdAt/updatedAt（2026-09-23 主干收缩，优先级等纯数据 CF 化）；
// 稳定子序统一 updatedAt desc（与旧内存排的 tie-break 一致，且分页翻页不跳动）。
// 自定义字段过滤——可检索类型收窄为仅 SELECT（等值/包含）。
// 未定义的 key 或不支持检索的类型直接忽略（字段被删/改名/类型不支持后旧链接不报错、退化为不过滤）。

/** 单个自定义字段过滤条件（issue 列表与全局搜索共用源） */
export function customFieldConditions(
  def: { key: string; type: string; settings?: unknown },
  raw: string,
): Prisma.IssueWhereInput[] {
  if (def.type !== "SELECT") return [];
  // SELECT 多选：值存 string[]，过滤为"包含"语义
  if (selectOrUserMultiple(def)) {
    return [{ fieldValues: { path: [def.key], array_contains: [raw] } }];
  }
  return [{ fieldValues: { path: [def.key], equals: raw } }];
}

function buildCustomFieldFilter(
  defs: { key: string; type: string; settings?: unknown }[],
  values: Record<string, string>,
) {
  const out: Prisma.IssueWhereInput[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const def = defs.find((d) => d.key === key);
    if (!def) continue;
    out.push(...customFieldConditions(def, raw));
  }
  return out;
}

function buildIssueWhere(projectId: string, f: IssueFilters, customFieldDefs: { key: string; type: string; settings?: unknown }[] = []) {
  const customFilters = f.fieldValues
    ? buildCustomFieldFilter(customFieldDefs, f.fieldValues)
    : [];
  return {
    projectId,
    isArchived: f.archived ?? false,
    ...(f.stateId ? { stateId: f.stateId } : {}),
    ...(f.assigneeId ? { assignees: { some: { userId: f.assigneeId } } } : {}),
    ...(customFilters.length ? { AND: customFilters } : {}),
    ...(f.q
      ? {
          OR: [
            { title: { contains: f.q, mode: "insensitive" as const } },
            { descriptionText: { contains: f.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  } satisfies Prisma.IssueWhereInput;
}

function buildIssueOrderBy(f: IssueFilters) {
  const dir = f.orderDir ?? "desc";
  // 主干仅时间序（缺陷追踪不承担排期/优先级排序；分类语义归自定义字段）。
  // isArchived 不参与排序：查询恒按 archived 过滤为单一值（未归档/已归档），排序键无意义
  const orderBy: Prisma.IssueOrderByWithRelationInput[] = [];
  if (f.orderBy === "createdAt") orderBy.push({ createdAt: dir });
  else orderBy.push({ updatedAt: dir });
  return orderBy;
}

export async function listIssues(
  projectId: string,
  f: IssueFilters,
  page = 1,
  pageSize = 50,
) {
  const customFieldDefs = f.fieldValues
    ? await prisma.customField.findMany({
        where: { projectId, isArchived: false },
        select: { key: true, type: true, settings: true },
      })
    : [];
  const where = buildIssueWhere(projectId, f, customFieldDefs);
  const [issues, total] = await Promise.all([
    prisma.issue.findMany({
      where,
      include: ISSUE_INCLUDE,
      orderBy: buildIssueOrderBy(f),
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    prisma.issue.count({ where }),
  ]);
  return { issues, total, page, pageSize };
}

export async function getIssue(projectId: string, number: number) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number } },
    include: ISSUE_INCLUDE,
  });
  if (!issue) throw new HttpError(404, "errors.issueNotFound");
  return issue;
}

// ── 创建：事务内自增项目序号 + CREATED 活动 + 通知 ──

/**
 * 成员引用校验（指派人与 USER 自定义字段共用）：
 * - 任何情况下都必须是该工作区的启用成员（防幽灵 id / 跨工作区引用）
 * - 私有项目额外要求 ProjectMember（否则引用到“看不见的人”）
 */
async function assertUsersVisible(
  tx: Prisma.TransactionClient,
  project: { id: string; workspaceId: string; isPrivate: boolean },
  userIds: string[],
  scopeField?: string,
) {
  if (userIds.length === 0) return;
  // 错误语境短语：{what} 由 locale 文案拼装（指派人 / 「字段」所选成员）
  const t = await recordTranslator();
  const what = scopeField
    ? t("errors.scopeFieldUsers", { field: scopeField })
    : t("errors.scopeAssignees");
  const wsMembers = await tx.workspaceMember.findMany({
    where: {
      workspaceId: project.workspaceId,
      userId: { in: userIds },
      user: { isActive: true },
    },
    select: { userId: true },
  });
  const inWorkspace = new Set(wsMembers.map((r) => r.userId));
  const notMember = userIds.filter((id) => !inWorkspace.has(id));
  if (notMember.length)
    throw new HttpError(422, "errors.selectedNotActiveMembers", undefined, {
      count: notMember.length,
      what,
    });

  if (!project.isPrivate) return;
  const pms = await tx.projectMember.findMany({
    where: { projectId: project.id, userId: { in: userIds } },
    select: { userId: true },
  });
  const inProject = new Set(pms.map((r) => r.userId));
  // 工作区负责人（OWNER）视为可见（与 resolveProjectAccess 一致）
  const admins = await tx.workspaceMember.findMany({
    where: {
      workspaceId: project.workspaceId,
      userId: { in: userIds },
      role: { in: ["OWNER"] },
    },
    select: { userId: true },
  });
  admins.forEach((r) => inProject.add(r.userId));
  const notVisible = userIds.filter((id) => !inProject.has(id));
  if (notVisible.length)
    throw new HttpError(422, "errors.selectedNotVisiblePrivate", undefined, {
      count: notVisible.length,
      what,
    });
}

async function assertAssigneesVisible(
  tx: Prisma.TransactionClient,
  project: { id: string; workspaceId: string; isPrivate: boolean },
  assigneeIds: string[],
) {
  await assertUsersVisible(tx, project, assigneeIds);
}

export async function createIssue(
  projectId: string,
  input: CreateIssueInput,
  actor: Actor,
) {
  const notificationIds: string[] = [];
  let createdNumber = 0;
  // 通知标题在触发动作的用户 locale 下渲染落库（站内/推送共用同一事实源）
  const t = await recordTranslator();
  await prisma.$transaction(async (tx) => {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { workspace: true },
    });
    if (!project) throw new HttpError(404, "errors.projectNotFound");
    if (input.assigneeIds?.length) await assertAssigneesVisible(tx, project, input.assigneeIds);

    // 自定义字段值——按项目字段定义动态校验（必填/枚举/类型/未知 key）
    const customFields = await activeFieldsFor(tx, projectId);
    const fieldValues = validateFieldValues(customFields, input.fieldValues, {
      enforceRequired: true,
    });
    // USER 字段值须为「能看到该项目」的成员（与指派人护栏同规则）
    for (const { field, userIds } of userFieldIdentifiers(customFields, fieldValues))
      await assertUsersVisible(tx, project, userIds, field.name);

    const seq = await tx.project.update({
      where: { id: projectId },
      data: { issueSeq: { increment: 1 } },
      select: { issueSeq: true },
    });

    // 显式传 null = 有意留“无状态”；缺省（undefined）落项目默认状态；传 id 则校验归属
    // （空串已被 zod min(1) 拦截，不会落到此分支）
    const state =
      input.stateId === null
        ? null
        : input.stateId !== undefined
          ? await tx.state.findUnique({ where: { id: input.stateId } })
          : await tx.state.findFirst({ where: { projectId, isDefault: true } });
    // 与 updateIssue 同护栏：显式传了 stateId 却查不到/跨项目 → 422，
    // 杜绝静默落为「无状态」的歧义（曾导致前端占位串 "default" 被当状态 ID 静默吞掉）
    if (input.stateId && (!state || state.projectId !== projectId))
      throw new HttpError(422, "errors.stateNotFound");

    const issue = await tx.issue.create({
      data: {
        projectId,
        number: seq.issueSeq,
        title: input.title,
        ...(input.description !== undefined && input.description !== null
          ? {
              description: input.description as Prisma.InputJsonValue,
              descriptionText: docToText(input.description as never),
            }
          : { descriptionText: input.descriptionText ?? "" }),
        stateId: state?.id ?? null,
        createdById: actor.id,
        ...(input.assigneeIds?.length
          ? { assignees: { create: input.assigneeIds.map((userId) => ({ userId })) } }
          : {}),
        ...(Object.keys(fieldValues).length
          ? { fieldValues: fieldValues as Prisma.InputJsonValue }
          : {}),
      },
      include: ISSUE_INCLUDE,
    });

    const createdAct = await tx.activity.create({
      data: { issueId: issue.id, projectId, actorId: actor.id, action: "CREATED" },
    });

    // 创建即指派也落 ASSIGNED 活动（与 update 路径同构）。
    // 通知是一条 NotifyItem 覆盖全体 assignee（与 update 路径不同：那边按人拆条），
    // activityId 统一挂首个 ASSIGNED 活动即可——深链只要求落在该 issue 的活动流上。
    const assignedActIds: string[] = [];
    if (input.assigneeIds?.length) {
      const users = await tx.user.findMany({
        where: { id: { in: input.assigneeIds } },
        select: { id: true, name: true },
      });
      const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id;
      for (const userId of input.assigneeIds) {
        const act = await tx.activity.create({
          data: {
            issueId: issue.id,
            projectId,
            actorId: actor.id,
            action: "ASSIGNED",
            field: "assignees",
            newValue: nameOf(userId),
          },
        });
        assignedActIds.push(act.id);
      }
    }

    const ref = `${project.slug.toUpperCase()}-${issue.number}`;
    const issueUrl = `/w/${project.workspace.slug}/p/${project.slug}/issues/${issue.number}`;

    const items: NotifyItem[] = [];
    if (input.assigneeIds?.length) {
      items.push({
        type: "ASSIGNED",
        userIds: input.assigneeIds,
        activityId: assignedActIds[0] ?? createdAct.id,
        title: t("im.instance.assigned", { project: project.name, actor: actor.name, ref }),
        body: issue.title,
      });
    }
    const mentioned = docToMentions(input.description as never);
    if (mentioned.size) {
      items.push({
        type: "MENTIONED",
        userIds: [...mentioned],
        activityId: createdAct.id,
        title: t("im.instance.mentioned", { project: project.name, actor: actor.name, ref }),
        body: issue.title,
      });
    }

    notificationIds.push(
      ...(await emitNotifications(tx, {
        projectId,
        issueId: issue.id,
        issueUrl,
        actorId: actor.id,
        items,
      })),
    );
    createdNumber = issue.number;
  });

  await dispatchIm(notificationIds);
  return getIssue(projectId, createdNumber);
}

// ── 更新：先 diff 出活动（逐条落库取 id），再生成通知 ──

export async function updateIssue(
  projectId: string,
  number: number,
  input: UpdateIssueInput,
  actor: Actor,
) {
  const notificationIds: string[] = [];
  const t = await recordTranslator();
  await prisma.$transaction(async (tx) => {
    const before = await tx.issue.findUnique({
      where: { projectId_number: { projectId, number } },
      include: {
        state: true,
        assignees: { select: { userId: true } },
      },
    });
    if (!before) throw new HttpError(404, "errors.issueNotFound");

    const project = await tx.project.findUnique({
      where: { id: projectId },
      include: { workspace: true },
    });
    if (!project) throw new HttpError(404, "errors.projectNotFound");
    if (input.assigneeIds !== undefined)
      await assertAssigneesVisible(tx, project, input.assigneeIds);

    const data: Prisma.IssueUpdateInput = {};
    const items: NotifyItem[] = [];
    const ref = `${project.slug.toUpperCase()}-${number}`;
    const issueUrl = `/w/${project.workspace.slug}/p/${project.slug}/issues/${number}`;
    const watchers = [
      ...new Set([
        ...before.assignees.map((a) => a.userId),
        before.createdById,
      ]),
    ];

    // 状态变更（含完成态语义：进入 COMPLETED 组打 completedAt，移出清空）
    if (input.stateId !== undefined && input.stateId !== before.stateId) {
      let newState: State | null = null;
      if (input.stateId !== null) {
        newState = await tx.state.findUnique({ where: { id: input.stateId } });
        if (!newState || newState.projectId !== projectId)
          throw new HttpError(422, "errors.stateNotFound");
      }
      const act = await tx.activity.create({
        data: {
          issueId: before.id, projectId, actorId: actor.id, action: "STATE_CHANGED",
          field: "state", oldValue: before.state?.name ?? undefined, newValue: newState?.name ?? undefined,
        },
      });
      data.state = input.stateId === null ? { disconnect: true } : { connect: { id: input.stateId } };
      // 首次进入 COMPLETED 记完成时间；完成态之间搬运不刷新（保留首次完成时间）。
      // 重新打开再来一遍会先走移出清空，再进 COMPLETED 时重打。
      if (newState?.group === "COMPLETED" && before.state?.group !== "COMPLETED")
        data.completedAt = new Date();
      else if (before.state?.group === "COMPLETED" && newState?.group !== "COMPLETED")
        data.completedAt = null;

      items.push({
        type: "STATE_CHANGED",
        userIds: watchers,
        activityId: act.id,
        title: t("im.instance.stateChanged", {
          project: project.name,
          actor: actor.name,
          ref,
          state: newState?.name ?? t("im.instance.noState"),
        }),
        body: before.title,
      });
    }

    // 指派人变更：新增→ASSIGNED，移除→UNASSIGNED（活动里直接存名字）
    const assignedActIds = new Map<string, string>();
    if (input.assigneeIds !== undefined) {
      const beforeSet = new Set(before.assignees.map((a) => a.userId));
      const afterSet = new Set(input.assigneeIds);
      if (beforeSet.size !== afterSet.size || [...afterSet].some((id) => !beforeSet.has(id))) {
        const allIds = [...new Set([...beforeSet, ...afterSet])];
        const users = allIds.length
          ? await tx.user.findMany({ where: { id: { in: allIds } }, select: { id: true, name: true } })
          : [];
        const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id;
        for (const id of afterSet)
          if (!beforeSet.has(id)) {
            const act = await tx.activity.create({
              data: {
                issueId: before.id, projectId, actorId: actor.id,
                action: "ASSIGNED", field: "assignees", newValue: nameOf(id),
              },
            });
            assignedActIds.set(id, act.id);
          }
        for (const id of beforeSet)
          if (!afterSet.has(id))
            await tx.activity.create({
              data: {
                issueId: before.id, projectId, actorId: actor.id,
                action: "UNASSIGNED", field: "assignees", oldValue: nameOf(id),
              },
            });
        data.assignees = {
          deleteMany: {},
          ...(afterSet.size ? { create: [...afterSet].map((userId) => ({ userId })) } : {}),
        };

        for (const [userId, actId] of assignedActIds) {
          items.push({
            type: "ASSIGNED",
            userIds: [userId],
            activityId: actId,
            title: t("im.instance.assigned", { project: project.name, actor: actor.name, ref }),
            body: before.title,
          });
        }
      }
    }

    // 普通字段
    if (input.title !== undefined && input.title !== before.title) {
      await tx.activity.create({
        data: { issueId: before.id, projectId, actorId: actor.id, action: "UPDATED", field: "title", oldValue: before.title, newValue: input.title },
      });
      data.title = input.title;
    }
    // 体验修复①（服务端兑底）：空白文档与 null 描述同义——旧版无条件全量 PATCH
    // 会把「没碰过描述」写成空文档，diff 永不相等 → 每次保存都多一条伪活动。
    // 只有「从有内容清到空」这种真实变化才落活动。
    const descBlank = (d: unknown) =>
      !d || (Array.isArray((d as { content?: unknown }).content) &&
        ((d as { content: unknown[] }).content.length === 0 ||
          (d as { content: { type?: string; content?: unknown[] }[] }).content.every(
            (n) => n?.type === "paragraph" && !(n.content ?? []).length)));
    const descNoop =
      input.description !== undefined &&
      descBlank(input.description) && descBlank(before.description);
    if (!descNoop && input.description !== undefined &&
        !jsonEqual(input.description, before.description)) {
      const act = await tx.activity.create({
        data: { issueId: before.id, projectId, actorId: actor.id, action: "UPDATED", field: "description" },
      });
      data.description = input.description as Prisma.InputJsonValue;
      data.descriptionText = input.description === null ? "" : docToText(input.description as never);

      // 仅"新提及"触发通知（旧提及不重复打扰）
      const newMentions = docToMentions(input.description as never);
      const oldMentions = docToMentions(before.description as never);
      const fresh = [...newMentions].filter((id) => !oldMentions.has(id));
      if (fresh.length) {
        items.push({
          type: "MENTIONED",
          userIds: fresh,
          activityId: act.id,
          title: t("im.instance.mentioned", { project: project.name, actor: actor.name, ref }),
          body: before.title,
        });
      }
    } else if (input.descriptionText !== undefined && input.descriptionText !== before.descriptionText) {
      await tx.activity.create({
        data: { issueId: before.id, projectId, actorId: actor.id, action: "UPDATED", field: "description" },
      });
      data.descriptionText = input.descriptionText;
    }
    if (input.isArchived !== undefined && input.isArchived !== before.isArchived) {
      await tx.activity.create({
        data: { issueId: before.id, projectId, actorId: actor.id, action: input.isArchived ? "ARCHIVED" : "UNARCHIVED" },
      });
      data.isArchived = input.isArchived;
    }

    // 自定义字段值——部分校验（已存在必填不回填，显式置空仍拦截），
    // 逐字段 diff 记 Activity（field = custom:<key>），Activity 作为唯一事实源自动喂给时间线/通知/Agent
    if (input.fieldValues !== undefined) {
      const fields = await activeFieldsFor(tx, projectId);
      const prev = (before.fieldValues ?? {}) as Record<string, unknown>;
      const next = validateFieldValues(fields, input.fieldValues, {
        enforceRequired: false,
        prevValues: prev, // 已软删选项的存量值放行，新选仍 422
      });
      // USER 字段值须为「能看到该项目」的成员
      for (const { field, userIds } of userFieldIdentifiers(fields, next))
        await assertUsersVisible(tx, project, userIds, field.name);
      const merged = { ...prev };
      let changed = false;
      for (const [key, value] of Object.entries(next)) {
        if (jsonEqual(value, prev[key])) continue;
        changed = true;
        merged[key] = value;
        const act = await tx.activity.create({
          data: {
            issueId: before.id,
            projectId,
            actorId: actor.id,
            action: "UPDATED",
            field: `custom:${key}`,
            oldValue: (prev[key] ?? undefined) as Prisma.InputJsonValue,
            newValue: (value ?? undefined) as Prisma.InputJsonValue,
          },
        });
        // 字段级通知规则（afterWrite 钩子，不改通知引擎核心）
        const rule = notifyRuleFor(fields.find((f) => f.key === key), value);
        if (rule) {
          const recipients = await notifyRecipients(tx, project, fields, merged, rule);
          const targets = recipients.filter((id) => id !== actor.id);
          if (targets.length) {
            const field = fields.find((f) => f.key === key)!;
            const display = await fieldTextForNotification(tx, field, value);
            items.push({
              type: "MENTIONED",
              userIds: targets,
              activityId: act.id,
              title: t("im.instance.fieldChanged", {
                project: project.name,
                actor: actor.name,
                ref,
                field: field.name,
                value: display,
              }),
              body: before.title,
            });
          }
        }
      }
      if (changed) data.fieldValues = merged as Prisma.InputJsonValue;
    }

    if (Object.keys(data).length > 0 || items.length > 0) {
      await tx.issue.update({ where: { id: before.id }, data });
      notificationIds.push(
        ...(await emitNotifications(tx, {
          projectId,
          issueId: before.id,
          issueUrl,
          actorId: actor.id,
          items,
        })),
      );
    }
  });

  await dispatchIm(notificationIds);

  return getIssue(projectId, number);
}

// ── 删除（走查补全：原先只有归档，元数据/测试数据无出口）──
// 破坏性操作：权限在路由层收紧为 项目负责人 ∨ 工作区负责人（统一 requireProjectAdmin）。
// 已知且接受的语义：硬删会级联清掉 Activity/Notification（通知中心相关条目随之消失）。
// 这是“物理删除”边界的一部分：保留痕迹请用归档；快照类审计（字段定义变更）
// 不受影响（CustomFieldRevision 与 issue 生命周期解耦）。
// 数据出口：评论/活动/通知等随 FK 级联；附件表无 FK（裸 issueId），
// 事务内先记录 storageKey、删行，事务外再删文件（文件 IO 不进事务）。
export async function deleteIssue(projectId: string, number: number) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number } },
    select: { id: true },
  });
  if (!issue) throw new HttpError(404, "errors.issueNotFound");
  const keys = await prisma.$transaction(async (tx) => {
    const atts = await tx.attachment.findMany({
      where: { issueId: issue.id },
      select: { storageKey: true },
    });
    await tx.attachment.deleteMany({ where: { issueId: issue.id } });
    await tx.issue.delete({ where: { id: issue.id } });
    return atts.map((a) => a.storageKey);
  });
  await Promise.all(keys.map((k) => deleteFile(k).catch(() => {}))); // 文件删除失败不阻断（行已删，孤儿文件无害）
}

// ── 批量更新（U3.1）：逐条复用 updateIssue 事务路径 ──
// 每条独立事务：部分失败不影响已成功项；Activity/通知/护栏与单条编辑完全同构
// （冻结纪律：Activity 是唯一事实源——通知引擎自动受益）

export async function batchUpdateIssues(
  projectId: string,
  numbers: number[],
  patch: { stateId?: string | null; assigneeIds?: string[]; isArchived?: boolean },
  actor: Actor,
) {
  const updated: number[] = [];
  const failed: { number: number; reason: string }[] = [];
  // failed[].reason 走响应通道（不经 handle 出口），在此按请求 locale 翻译
  const t = await recordTranslator();
  for (const number of numbers) {
    try {
      await updateIssue(projectId, number, patch as UpdateIssueInput, actor);
      updated.push(number);
    } catch (err) {
      // 已知业务错误（4xx）给人话原文；未知错误统一封装——不向客户端透出 Prisma/内部信息
      // 5xx 也必须在服务端留痕，否则批量路径是黑盒子（单条路径会经 handle 打日志）
      if (!(err instanceof HttpError)) console.error("[batch] update failed:", err);
      failed.push({
        number,
        reason: err instanceof HttpError
          ? t(err.message, err.params)
          : t("errors.batchUpdateFailed", {
              name: err instanceof Error ? err.name : t("errors.internalErrorName"),
            }),
      });
    }
  }
  return { updated, failed };
}

// ── 活动时间线 ──

// 复合游标（时间,id）：无游标返回最新 100 条，翻页用 before/beforeId——
// 否则活动超 100 条的问题时间线被静默截断，且与评论/通知的分页方案不一致
export async function listIssueActivities(
  projectId: string,
  number: number,
  cursor?: import("@/lib/api").TimeCursor,
) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number } },
    select: { id: true },
  });
  if (!issue) throw new HttpError(404, "errors.issueNotFound");
  return prisma.activity.findMany({
    where: {
      issueId: issue.id,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.before } },
              { createdAt: cursor.before, id: { lt: cursor.beforeId } },
            ],
          }
        : {}),
    },
    include: { actor: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
}
