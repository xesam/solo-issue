"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { JSONContent } from "@tiptap/core";
import { docToText } from "@/lib/tiptap-text";
import type { IssueDTO } from "@/lib/dto";
import {
  apiDelete,
  apiPatch,
  apiPost,
  apiUpload,
  fetchEarlierTimeline,
  useInvalidateTimeline,
  useInvalidateIssue,
  useIssue,
  useTimeline,
  useAttachments,
  useCustomFields,
  useAssignableMembers,
  useStates,
  type TimelineItemDTO,
} from "@/lib/client/api";
import { withBase } from "@/lib/base-path";
import RichEditor from "@/components/editor/RichEditor";
import ReadOnlyDoc from "@/components/editor/ReadOnlyDoc";
import type { FieldValues } from "@/components/issues/CustomFieldInput";
import { toast } from "sonner";
import { fmtDateTime } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import IssueForm, { type IssueFormValues } from "@/components/issues/IssueForm";
import IssueShell from "@/components/issues/IssueShell";
import { AttachmentTile } from "@/components/issues/AttachmentPicker";
import type { Translator } from "@/i18n/config";

const FIELD_LABEL: Record<string, string> = {
  title: "fieldTitle",
  description: "fieldDescription",
};

// fieldValues 结构化比较：服务端会归一化（""→null、类型强转、多选去重）且重建
// 对象可能变键序——JSON.stringify 整体比较既假脏又漏判。这里逐 key 比较：
// 空值（null/undefined/""）视为未设置，数组忽略顺序，其余原值比较。
function fieldValuesEqual(
  a: FieldValues | null | undefined,
  b: FieldValues | null | undefined,
): boolean {
  const pick = (v: FieldValues | null | undefined) => {
    const m = new Map<string, unknown>();
    for (const [k, val] of Object.entries(v ?? {})) {
      if (val === null || val === undefined || val === "") continue;
      m.set(k, Array.isArray(val) ? [...val].sort() : val);
    }
    return m;
  };
  const A = pick(a);
  const B = pick(b);
  if (A.size !== B.size) return false;
  for (const [k, v] of A) {
    const w = B.get(k);
    if (w === undefined) return false;
    if (Array.isArray(v) && Array.isArray(w)) {
      if (v.length !== w.length || v.some((x, i) => x !== w[i])) return false;
    } else if (JSON.stringify(v) !== JSON.stringify(w)) return false;
  }
  return true;
}

// 合并时间线里的活动条目 → 人话（沿用旧活动时间线的文案映射）
function activityText(
  a: Extract<TimelineItemDTO, { kind: "activity" }>,
  customFieldNames: Map<string, string>,
  t: Translator,
): string {
  const old = a.oldValue == null ? null : String(a.oldValue);
  const nw = a.newValue == null ? null : String(a.newValue);
  switch (a.action) {
    case "CREATED":
      return t("activity.created");
    case "STATE_CHANGED":
      return t("activity.stateChanged", {
        from: old ?? t("activity.empty"),
        to: nw ?? t("activity.empty"),
      });
    case "ASSIGNED":
      return t("activity.assigned", { name: nw ?? "" });
    case "UNASSIGNED":
      return t("activity.unassigned", { name: old ?? "" });
    case "ARCHIVED":
      return t("activity.archived");
    case "UNARCHIVED":
      return t("activity.unarchived");
    case "UPDATED": {
      if (a.field === "description") return t("activity.updatedDescription");
      if (a.field?.startsWith("custom:")) {
        const name = customFieldNames.get(a.field.slice("custom:".length));
        return t("activity.updatedField", { field: name || t("activity.customField") });
      }
      const f = a.field ? t(FIELD_LABEL[a.field] ?? a.field) : "";
      return t("activity.updatedField", { field: f });
    }
    default:
      return a.action;
  }
}

export default function IssueDetail({
  wsSlug,
  projectSlug,
  projectName,
  projectId,
  projectIsPrivate,
  number,
  initialIssue,
}: {
  wsSlug: string;
  projectSlug: string;
  projectName: string;
  projectId: string;
  projectIsPrivate: boolean;
  number: number;
  initialIssue: IssueDTO;
}) {
  const { data: issue } = useIssue(projectId, number, initialIssue);
  const timeline = useTimeline(projectId, number);
  const attachments = useAttachments(projectId, number);
  const states = useStates(projectId);
  const customFields = useCustomFields(projectId);
  const members = useAssignableMembers(wsSlug, projectId, projectIsPrivate);
  const invalidate = useInvalidateIssue(projectId, number);
  const invalidateTimeline = useInvalidateTimeline(projectId, number);
  const t = useTranslations("issues");
  const tCommon = useTranslations("common");

  const [title, setTitle] = useState(initialIssue.title);
  const [descDoc, setDescDoc] = useState<JSONContent | null>(
    (initialIssue.description as JSONContent | null) ?? null,
  );
  const [stateId, setStateId] = useState<string>(initialIssue.stateId ?? "");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    initialIssue.assignees.map((a) => a.user.id),
  );
  const [fieldValues, setFieldValues] = useState<FieldValues>(
    (initialIssue.fieldValues as FieldValues | null) ?? {},
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [commentDoc, setCommentDoc] = useState<JSONContent | null>(null);
  const [commentKey, setCommentKey] = useState(0); // 发送后重置编辑器
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // 删除附件二次确认（不可恢复操作）：待删项暂存 { id, name }
  const [attRemoveTarget, setAttRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [commenting, setCommenting] = useState(false);

  // 描述基线：仅真正改动过描述才随「保存」发送（防伪「更新了描述」活动）
  const descBaseRef = useRef<string>(JSON.stringify(initialIssue.description ?? null));

  // 合并时间线复合游标分批拉（模式同旧评论流）：
  // earlier = 已加载的更早批次，拼在最新窗口之前；30s 刷新只重拉最新窗口。
  // 窗口随新消息向后滚动，一旦滚过 earlier 的挂接点（加载时的窗口最旧一条），
  // 拼接就会留出"既不在窗口也不在 earlier"的永不愈合空洞——此时弃置 earlier。
  const [earlier, setEarlier] = useState<TimelineItemDTO[]>([]);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const earlierBoundary = useRef<string | null>(null);
  const router = useRouter();

  // dirty：本地编辑 vs 服务器快照。供：sticky 保存栏变色、beforeunload/路由离开拦截、轮询防回写
  const dirty =
    !!issue &&
    (title !== issue.title ||
      JSON.stringify(descDoc ?? null) !== descBaseRef.current ||
      (stateId || "") !== (issue.stateId ?? "") ||
      JSON.stringify([...assigneeIds].sort()) !==
        JSON.stringify(issue.assignees.map((a) => a.user.id).sort()) ||
      !fieldValuesEqual(fieldValues, issue.fieldValues as FieldValues | null));
  const items = [...earlier, ...(timeline.data?.items ?? [])];
  const canLoadEarlier = earlier.length
    ? hasEarlier
    : (timeline.data?.hasMore ?? false);

  async function loadEarlier() {
    const oldest = items[0];
    if (!oldest || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const res = await fetchEarlierTimeline(projectId, number, {
        before: new Date(oldest.createdAt).toISOString(),
        beforeId: oldest.id,
      });
      setEarlier((prev) => [...res.items, ...prev]);
      setHasEarlier(res.hasMore);
      earlierBoundary.current = oldest.id; // earlier 的挂接点 = 本次加载时窗口的最旧一条
    } catch {
      toast.error(t("loadEarlierFailed"));
    } finally {
      setLoadingEarlier(false);
    }
  }

  // 最新窗口与 earlier 的衔接检查（见上方 state 声明处的说明）
  useEffect(() => {
    const win = timeline.data?.items;
    if (!earlier.length || !win?.length) return;
    if (earlierBoundary.current && !win.some((it) => it.id === earlierBoundary.current)) {
      setEarlier([]);
      setHasEarlier(false);
      earlierBoundary.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline.data?.items]);

  useEffect(() => {
    // 协作轮询防噪：有未保存本地修改时不回写服务器状态（否则 30s 轮询会把正在敲的字冲掉）
    if (issue && !dirty) {
      setTitle(issue.title);
      setDescDoc((issue.description as JSONContent | null) ?? null);
      setStateId(issue.stateId ?? "");
      setAssigneeIds(issue.assignees.map((a) => a.user.id));
      setFieldValues((issue.fieldValues as FieldValues | null) ?? {});
      descBaseRef.current = JSON.stringify(issue.description ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.updatedAt, dirty === false]);

  // 浏览器级离开拦截（页内 Link 的拦截在面包屑处）
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  async function save(andBack = false) {
    // 与「保存」按钮同闸（⌘Enter 旁路不经 disabled）：
    // - 防重入：并行双发 PATCH 相互踩
    // - 「没改动」/「标题空」同样拒绝——按钮置灰的理由快捷键不得绕过
    if (saving || !dirty || !title.trim()) return;
    setSaving(true);
    setError(null);
    const descChanged = JSON.stringify(descDoc ?? null) !== descBaseRef.current;
    // 请求飞行中用户可能继续编辑：响应收敛只覆盖「未被继续动过」的字段。
    // 必须用函数式 setState 与最新值比对——闭包里的 title 等被 await 冻结，
    // 直接 `title === snap.title` 恒真，等于把飞行中的编辑也覆盖掉
    const snap = { title, stateId, assigneeIds, fieldValues };
    try {
      const saved = await apiPatch<IssueDTO>(
        `/api/projects/${projectId}/issues/${number}`,
        {
          title,
          ...(descChanged ? { description: descDoc ?? { type: "doc", content: [] } } : {}),
          stateId: stateId || null,
          assigneeIds,
          fieldValues,
        },
      );
      // 保存成功后以服务端归一化结果收敛本地状态，摆脱「dirty 卡死」：
      // 服务端会 trim 标题、归一化字段值——本地若保留用户原始输入，
      // 与刷新回来的 DTO 结构不等，dirty 永远无法回到 false（防回写
      // effect 只在 !dirty 时同步，形成死锁）；描述基线同样以响应为准
      setTitle((v) => (v === snap.title ? saved.title : v));
      setStateId((v) => (v === snap.stateId ? (saved.stateId ?? "") : v));
      setAssigneeIds(
        (v) =>
          JSON.stringify([...v].sort()) === JSON.stringify([...snap.assigneeIds].sort())
            ? saved.assignees.map((a) => a.user.id)
            : v,
      );
      setFieldValues(
        (v) => (fieldValuesEqual(v, snap.fieldValues) ? ((saved.fieldValues as FieldValues | null) ?? {}) : v),
      );
      if (descChanged)
        descBaseRef.current = JSON.stringify(saved.description ?? null);
      invalidate();
      invalidateTimeline();
      toast.success(tCommon("saved"));
      if (andBack) router.push(backHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function submitComment() {
    setCommenting(true);
    try {
      await apiPost(`/api/projects/${projectId}/issues/${number}/comments`, {
        body: commentDoc ?? { type: "doc", content: [] },
      });
      setCommentDoc(null);
      setCommentKey((k) => k + 1);
      invalidateTimeline();
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("sendFailed"));
    } finally {
      setCommenting(false);
    }
  }

  async function uploadAttachment(file: File) {
    const att = await apiUpload<import("@prisma/client").Attachment>(
      `/api/projects/${projectId}/issues/${number}/attachments`,
      file,
    );
    attachments.refetch();
    // src 会持久化进 Tiptap 文档 JSON，必须带部署前缀（basePath 下裸根路径 404）
    return withBase(`/api/attachments/${att.id}`);
  }

  async function removeAttachment(id: string) {
    try {
      await apiDelete(`/api/attachments/${id}`);
      attachments.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("deleteAttachmentFailed"));
    }
  }

  async function archive() {
    try {
      await apiPatch(`/api/projects/${projectId}/issues/${number}`, {
        isArchived: !issue?.isArchived,
      });
      invalidate();
      toast.success(issue?.isArchived ? t("restoredToast") : t("archivedToast"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("operationFailed"));
    }
  }

  // 站内强确认（替代原生 prompt）：需输入编号一致才可确认
  function del() {
    setShowDeleteConfirm(true);
  }

  async function doDelete() {
    const ref = `${projectSlug.toUpperCase()}-${number}`;
    setSaving(true);
    try {
      await apiDelete(`/api/projects/${projectId}/issues/${number}`);
      invalidate();
      toast.success(t("deletedToast", { ref }));
      router.push(backHref);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("deleteFailed"));
      setSaving(false);
    }
  }

  const memberOptions = (members.data ?? []).map((m) => ({
    id: m.user.id,
    label: m.user.name,
    email: m.user.email,
    origin: m.user.origin, // 候选凭据标识：IM 账号显来源、邮箱账号显邮箱，重名可辨
  }));
  // 判空用 docToText（与服务端同源），杜绝「打过字又全删」仍可发送
  const canSend = !!commentDoc && docToText(commentDoc).length > 0;
  const backHref = `/w/${wsSlug}/p/${projectSlug}`;
  // 页内离开拦截：受控出口两处（面包屑、「取消」按钮，同一弹窗两个触发点；dirty 时先弹站内确认，干净直接走）。
  // 已知边界：侧栏/顶栏的客户端路由导航不触发 beforeunload，dirty 修改会被静默
  // 丢弃——彻底拦截需要全局路由 blocker（产品级决策），当前只守浏览器级与面包屑
  // （替代原生 window.confirm：不被浏览器抑制、与全站风格一致）
  const confirmLeave = (e: React.MouseEvent) => {
    if (dirty) {
      e.preventDefault();
      setShowLeaveConfirm(true);
    }
  };

  return (
    <div>
      <IssueShell
        backHref={backHref}
        projectName={projectName}
        crumb={`${projectSlug.toUpperCase()}-${number}`}
        onBackClick={confirmLeave}
        main={
          <IssueForm
            values={{
              title,
              descDoc,
              stateId,
              assigneeIds,
              fieldValues,
              stagedFiles: [],
            }}
            onChange={(patch) => {
              if (patch.title !== undefined) setTitle(patch.title);
              if (patch.descDoc !== undefined) setDescDoc(patch.descDoc);
              if (patch.stateId !== undefined) setStateId(patch.stateId);
              if (patch.assigneeIds !== undefined) setAssigneeIds(patch.assigneeIds);
              if (patch.fieldValues !== undefined) setFieldValues(patch.fieldValues);
            }}
            states={states.data}
            stateValue={stateId}
            showNone
            members={members.data}
            knownUsers={(issue?.assignees ?? initialIssue.assignees).map((a) => a.user)}
            customFields={customFields.data}
            descPlaceholder={t("descPlaceholderEdit")}
            onUploadImage={uploadAttachment}
            onPickFiles={(picked) =>
              picked.forEach((f) =>
                void uploadAttachment(f).catch((err) =>
                  toast.error(err instanceof Error ? err.message : t("attachmentUploadFailed")),
                ),
              )
            }
            attachments={
              <>
                {attachments.data?.map((att) => (
                  <AttachmentTile
                    key={att.id}
                    name={att.filename}
                    image={
                      att.mimeType.startsWith("image/")
                        ? withBase(`/api/attachments/${att.id}`)
                        : null
                    }
                    href={withBase(`/api/attachments/${att.id}`)}
                    onRemove={() => setAttRemoveTarget({ id: att.id, name: att.filename })}
                  />
                ))}
              </>
            }
            error={error}
            onSubmit={() => void save()}
            dirty={dirty}
            primary={
              <>
              <Button
                type="submit"
                disabled={saving || !dirty || !title.trim()}
              >
                {saving ? tCommon("saving") : tCommon("save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void save(true)}
                disabled={saving || !dirty || !title.trim()}
              >
                {t("saveAndBack")}
              </Button>
              </>
            }
            secondary={
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={del}
                  disabled={saving}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  {tCommon("delete")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={archive}
                  disabled={saving}
                >
                  {issue?.isArchived ? t("restoreFromArchive") : t("archive")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => (dirty ? setShowLeaveConfirm(true) : router.push(backHref))}
                  disabled={saving}
                >
                  {tCommon("cancel")}
                </Button>
              </>
            }
          />
        }
        aside={
          <>
          <h3 className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
            {timeline.data
              ? t("timelineCount", { count: timeline.data.total })
              : t("timeline")}
          </h3>

          {canLoadEarlier && (
            <div className="mb-3 flex shrink-0 justify-center">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={loadEarlier}
                disabled={loadingEarlier}
              >
                {loadingEarlier ? tCommon("loading") : t("loadEarlier")}
              </Button>
            </div>
          )}

          {/* 时间线竖线改由每个 li 自画（before:inset-y-0 覆盖自身 pb）：
	      ol 内滚后整段的绝对定位线只以滚动视口为参照、滚过即断；
	      pr-2 给窄滚动条留缓冲边距，间距用 pb 替代 space-y 使线连续 */}
          <ol className="scroll-slim relative min-h-0 flex-1 pr-2 lg:overflow-y-auto">
            {items.map((it) =>
              it.kind === "comment" ? (
                <li
                  key={it.id}
                  className="relative before:absolute before:inset-y-0 before:left-[5px] before:w-px before:bg-border pl-6 pb-4 last:pb-0"
                >
                  <span className="absolute left-0 top-1.5 size-[11px] rounded-full border-2 border-background bg-primary/70" />
                  <div className="min-w-0">
                    <p className="flex items-baseline gap-2 text-xs text-muted-foreground">
                      <b className="shrink-0 font-medium text-foreground/80">{it.author.name}</b>
                      <span className="ml-auto shrink-0 self-start text-right tabular-nums text-muted-foreground/70">{fmtDateTime(it.createdAt)}</span>
                    </p>
                    <div className="mt-1 rounded-xl bg-muted/70 px-3.5 py-2.5 text-xs text-foreground/80">
                      <ReadOnlyDoc doc={it.body as JSONContent} />
                    </div>
                  </div>
                </li>
              ) : (
                // 活动条目弱化：小字灰，评论是右栏的主角
                <li
                  key={it.id}
                  className="relative before:absolute before:inset-y-0 before:left-[5px] before:w-px before:bg-border flex items-start gap-2 pl-6 pb-4 text-xs last:pb-0"
                >
                  <span className="absolute left-[3px] top-[7px] size-[5px] rounded-full bg-muted-foreground/40" />
                  <span className="min-w-0 flex-1 text-foreground/80">
                    <b className="font-medium">{it.actor?.name ?? t("system")}</b>{" "}
                    {activityText(
                      it,
                      new Map(
                        (customFields.data ?? []).map((c) => [c.key, c.name]),
                      ),
                      t,
                    )}
                  </span>
                  <span className="shrink-0 self-start text-right tabular-nums text-muted-foreground/70">{fmtDateTime(it.createdAt)}</span>
                </li>
              ),
            )}
            {!items.length && (
              <li className="text-xs text-muted-foreground">{t("noRecords")}</li>
            )}
          </ol>

          {/* 评论输入：flex 列固定页脚（时间线 ol 自己内滚，输入框不遮内容） */}
          <div className="mt-4 shrink-0 border-t border-border py-3">
            <RichEditor
              key={commentKey}
              doc={undefined}
              onUpdate={setCommentDoc}
              members={memberOptions}
              placeholder={t("commentPlaceholder")}
              compact
              onUploadImage={uploadAttachment}
            />
            <div className="mt-2 flex justify-end pb-1">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={submitComment}
                disabled={commenting || !canSend}
              >
                {commenting ? t("sending") : t("sendComment")}
              </Button>
            </div>
          </div>
          </>
        }
      />

      {/* 离开确认：dirty 时点面包屑返回触发（替代原生 confirm） */}
      <ConfirmDialog
        open={showLeaveConfirm}
        title={t("discardTitleEdit")}
        description={t("discardDescEdit")}
        confirmLabel={t("discardConfirmEdit")}
        destructive
        onCancel={() => setShowLeaveConfirm(false)}
        onConfirm={() => {
          setShowLeaveConfirm(false);
          router.push(backHref);
        }}
      />

      {/* 删除附件确认：不可恢复操作（risky-action 二次确认纪律） */}
      <ConfirmDialog
        open={attRemoveTarget !== null}
        title={t("attachmentRemoveTitle", { name: attRemoveTarget?.name ?? "" })}
        description={t("attachmentRemoveDesc")}
        confirmLabel={t("attachmentRemoveConfirm")}
        destructive
        onCancel={() => setAttRemoveTarget(null)}
        onConfirm={() => {
          const target = attRemoveTarget;
          setAttRemoveTarget(null);
          if (target) void removeAttachment(target.id);
        }}
      />

      {/* 删除确认：输入编号强校验（替代原生 prompt） */}
      <ConfirmDialog
        open={showDeleteConfirm}
        title={t("deleteTitle", { ref: `${projectSlug.toUpperCase()}-${number}` })}
        description={t("deleteDesc")}
        confirmLabel={t("deletePermanent")}
        destructive
        requireInput={{ hint: t("deleteConfirmHint", { number }), match: String(number) }}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          void doDelete();
        }}
      />
    </div>
  );
}
