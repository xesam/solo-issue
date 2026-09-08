"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiDelete, apiPatch, useProject } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/ui/confirm-dialog";

// 项目治理——高级 tab（归档 / 删除）。
// 删除双闸：前端 ConfirmDialog 输入项目标识强确认；服务端强制 0 问题 + 权限护栏。

export default function ProjectAdvancedTab({
  projectId,
  projectSlug,
  onArchived,
  onDeleted,
}: {
  projectId: string;
  projectSlug?: string;
  onArchived: (archived: boolean) => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const t = useTranslations("project");
  const { data: project, isLoading } = useProject(projectId);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (isLoading || !project) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  async function patch(body: Record<string, unknown>, okMsg?: string) {
    setSaving(true);
    try {
      await apiPatch(`/api/projects/${projectId}`, body);
      // 关键：同步失效详情缓存——否则弹窗内 name/isArchived 停留旧值
      await qc.invalidateQueries({ queryKey: ["project", projectId] });
      if (okMsg) toast.success(okMsg);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("operationFailed"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    setDeleting(true);
    try {
      await apiDelete(`/api/projects/${projectId}`);
      toast.success(t("projectDeletedToast"));
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("deleteFailed"));
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 归档：头部条卡片（bg-muted/50 同构卡片语言），操作位点在头部右端 */}
      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between rounded-t-xl bg-muted/50 px-4 py-3">
          <div>
            <p className="text-sm font-medium">{t("archiveProject")}</p>
            <p className="text-xs text-muted-foreground">
              {t("archiveProjectDesc")}
            </p>
          </div>
          <Switch
            checked={project.isArchived}
            disabled={saving}
            // 仅在落库成功后回调（失败保留原开关位置，不产生"看似已归档"的假态）
            onCheckedChange={(v) => void patch({ isArchived: v }).then((ok) => ok && onArchived(v))}
            aria-label={t("archiveProject")}
          />
        </div>
      </section>

      {/* 删除（危险区）：头部条用 destructive 变体，危险度由颜色而非位置表达 */}
      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between rounded-t-xl bg-destructive/10 px-4 py-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
              <Trash2 className="size-4" aria-hidden />
              {t("deleteProject")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("deleteDescHead")}<b>{t("deleteDescZero")}</b>{t("deleteDescTail")}
            </p>
          </div>
        </div>
        <div className="p-4">
          <Button
            size="sm"
            variant="destructive"
            disabled={deleting}
            onClick={() => setConfirmOpen(true)}
          >
            {t("deleteProjectButton")}
          </Button>
        </div>
      </section>

      {/* 删除确认：ConfirmDialog 输入项目标识强确认（不可逆操作走二次确认，
          ui-guidelines §2；slug 精确匹配 + 服务端 0 问题护栏双闸） */}
      <ConfirmDialog
        open={confirmOpen}
        title={t("deleteConfirmTitle", { name: project.name })}
        description={t("deleteConfirmDesc")}
        confirmLabel={t("deleteProject")}
        destructive
        requireInput={{
          hint: t("typeSlugHint", { slug: projectSlug ?? project.slug }),
          match: projectSlug ?? project.slug,
        }}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void del();
        }}
      />
    </div>
  );
}
