"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  apiPost,
  apiUpload,
  useAssignableMembers,
  useCustomFields,
  useInvalidateIssue,
  useStates,
} from "@/lib/client/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/confirm-dialog";
import IssueForm, { type IssueFormValues } from "@/components/issues/IssueForm";
import IssueShell from "@/components/issues/IssueShell";

// 创建问题（页面模式）：与编辑页共用 IssueShell（页面骨架）+ IssueForm（表单）。
// 本页只负责创建 IO：POST 创建 → 附件补传 → 跳转详情页；
// 「创建并返回」则回项目主页——连建提速（回列表再点新建），替代已裁撤的「创建下一个」。
// 右栏为空态预告（无评论入口）。

export default function CreateIssuePage({
  wsSlug,
  projectSlug,
  projectName,
  projectId,
  projectIsPrivate,
}: {
  wsSlug: string;
  projectSlug: string;
  projectName: string;
  projectId: string;
  projectIsPrivate: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("issues");
  const tCommon = useTranslations("common");
  const [values, setValues] = useState<IssueFormValues>({
    title: "",
    descDoc: null,
    stateId: "",
    assigneeIds: [],
    fieldValues: {},
    stagedFiles: [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const statesQuery = useStates(projectId);
  const states = statesQuery.data;
  const customFields = useCustomFields(projectId);
  // 候选与服务端指派/提及校验镜像：公开项目=启用的工作区成员，私有项目=项目成员∪工作区负责人
  const members = useAssignableMembers(wsSlug, projectId, projectIsPrivate).data;

  // 预选项目的默认状态（isDefault）；不传 stateId 时服务端也是取它，双保险
  const defaultStateId = states?.find((s) => s.isDefault)?.id ?? "";
  // states 到位前下拉会显示「无状态」而实际落库是默认状态（所见 ≠ 所得）——
  // 加载窗口内禁用创建，杜绝用户按误导显示提交
  const statesLoading = statesQuery.isLoading;

  const invalidate = useInvalidateIssue(projectId);

  function onChange(patch: Partial<IssueFormValues>) {
    setValues((prev) => ({ ...prev, ...patch }));
  }

  const dirty =
    !!values.title.trim() ||
    values.assigneeIds.length > 0 ||
    Object.keys(values.fieldValues).length > 0 ||
    values.stagedFiles.length > 0 ||
    (!!values.stateId && values.stateId !== defaultStateId) ||
    !!values.descDoc?.content?.length;

  // 脏状态守卫：刷新/关闭前提醒
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const backHref = `/w/${wsSlug}/p/${projectSlug}`;

  async function doCreate(andBack = false) {
    // 与提交按钮同闸（statesLoading：状态下拉未就绪时 stateId 归一化依赖它，
    // 快捷键/回车等旁路不能绕过置灰条件）
    if (!values.title.trim() || saving || statesLoading) return;
    setSaving(true);
    setError(null);
    try {
      const { title, descDoc, stateId, assigneeIds, fieldValues, stagedFiles } = values;
      const created = await apiPost<{ number: number }>(`/api/projects/${projectId}/issues`, {
        title,
        description: descDoc ?? undefined,
        ...(stateId ? { stateId } : {}),
        assigneeIds,
        ...(Object.keys(fieldValues).length ? { fieldValues } : {}),
      });
      // 附件补传：issue 已存在；单个失败不影响创建结果，仅提示重试途径
      // （「并返回」时人不在详情页，提示需带编号指路）
      if (stagedFiles.length) {
        let failed = 0;
        for (const f of stagedFiles) {
          try {
            await apiUpload(
              `/api/projects/${projectId}/issues/${created.number}/attachments`,
              f,
            );
          } catch {
            failed++;
            toast.error(
              andBack
                ? t("attachmentFailedList", { name: f.name, number: created.number })
                : t("attachmentFailedHere", { name: f.name }),
            );
          }
        }
        if (!failed) toast.success(t("attachmentsUploaded", { count: stagedFiles.length }));
      }
      invalidate();
      toast.success(t("createdToast", { number: created.number }));
      router.push(andBack ? backHref : `${backHref}/issues/${created.number}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <IssueShell
        backHref={backHref}
        projectName={projectName}
        crumb={t("newIssue")}
        main={
          <IssueForm
            values={values}
            onChange={onChange}
            states={states}
            stateValue={values.stateId || defaultStateId}
            showNone={!defaultStateId}
            members={members}
            customFields={customFields.data}
            descPlaceholder={t("descPlaceholderNew")}
            titleAutofocus
            error={error}
            onSubmit={doCreate}
            primary={
              <>
                <Button type="submit" disabled={saving || statesLoading || !values.title.trim()}>
                  {saving ? tCommon("creating") : (
                    <>
                      {tCommon("create")}
                      <kbd className="ml-1 rounded-md border border-border bg-muted px-1 text-xs text-muted-foreground">⌘↵</kbd>
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void doCreate(true)}
                  disabled={saving || statesLoading || !values.title.trim()}
                >
                  {t("createAndBack")}
                </Button>
              </>
            }
            secondary={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => (dirty ? setShowLeaveConfirm(true) : router.push(backHref))}
                disabled={saving}
              >
                {tCommon("cancel")}
              </Button>
            }
          />
        }
        aside={
          <>
            <h3 className="mb-3 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
              {t("timeline")}
            </h3>
            <p className="text-xs text-muted-foreground/70">
              {t("timelineEmptyHint")}
            </p>
          </>
        }
      />

      {/* 取消时 dirty 守卫（与编辑页同构）：有输入先确认，替代静默丢弃 */}
      <ConfirmDialog
        open={showLeaveConfirm}
        title={t("discardTitleNew")}
        description={t("discardDescNew")}
        confirmLabel={t("discardConfirmNew")}
        destructive
        onCancel={() => setShowLeaveConfirm(false)}
        onConfirm={() => {
          setShowLeaveConfirm(false);
          router.push(backHref);
        }}
      />
    </>
  );
}
