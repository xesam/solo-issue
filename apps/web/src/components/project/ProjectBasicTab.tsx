"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiPatch, useProject } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

// 项目治理——基本信息 tab（重命名）。归档与删除在高级 tab（ProjectAdvancedTab）。

export default function ProjectBasicTab({
  projectId,
  onRenamed,
}: {
  projectId: string;
  onRenamed: () => void;
}) {
  const qc = useQueryClient();
  const t = useTranslations("project");
  const tCommon = useTranslations("common");
  const { data: project, isLoading } = useProject(projectId);
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (isLoading || !project) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const currentName = name ?? project.name;
  const dirty = name !== null && name.trim() !== project.name && name.trim().length > 0;

  async function patch(body: Record<string, unknown>, okMsg?: string) {
    setSaving(true);
    try {
      await apiPatch(`/api/projects/${projectId}`, body);
      // 关键：同步失效详情缓存——否则组件内 name 停留旧值
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

  return (
    <section className="rounded-xl border border-border bg-card shadow-sm">
      {/* 重命名：头部条卡片，与项目类型/归档等设置卡片同构 */}
      <div className="flex items-center justify-between rounded-t-xl bg-muted/50 px-4 py-3">
        <div>
          <p className="text-sm font-medium">{t("nameLabel")}</p>
          <p className="text-xs text-muted-foreground">
            {t("nameHint", { slug: project.slug })}
          </p>
        </div>
      </div>
      <div className="p-4">
        <div className="flex gap-2">
          <Input
            value={currentName}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="max-w-xs"
          />
          <Button
            size="sm"
            disabled={!dirty || saving}
            onClick={async () => {
              if (await patch({ name: currentName.trim() }, t("renamedToast"))) {
                setName(null);
                onRenamed();
              }
            }}
          >
            {tCommon("save")}
          </Button>
        </div>
      </div>
    </section>
  );
}
