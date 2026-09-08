"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiPost } from "@/lib/client/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// 新建项目表单——单源：唯一调用方是 CreateProjectDialog（弹窗形态：
// label 置顶、纵向留白、整宽主按钮）。
// 创建成功后失效两组缓存：["projects", wsSlug]（页面卡片与侧边栏列表）、
// ["workspaces", "mine"]（工作区切换器的 projectCount——全局
// refetchOnWindowFocus=false，不主动失效会一直陈旧）。
// 随后默认打开新项目主页（/w/:wsSlug/p/:slug）。

export default function CreateProjectForm({
  wsSlug,
  autoFocus,
  onCreated,
  onCancel,
}: {
  wsSlug: string;
  autoFocus?: boolean;
  onCreated?: () => void;
  /** 弹窗壳传入以获得「取消」钮（页内内联形态不传） */
  onCancel?: () => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const t = useTranslations("workspace");
  const tCommon = useTranslations("common");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const project = await apiPost<{ slug: string }>(
        `/api/workspaces/${wsSlug}/projects`,
        { name },
      );
      toast.success(t("createdToast"));
      setName("");
      onCreated?.();
      await qc.invalidateQueries({ queryKey: ["projects", wsSlug] });
      void qc.invalidateQueries({ queryKey: ["workspaces", "mine"] });
      router.push(`/w/${wsSlug}/p/${project.slug}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-1">
        <Label htmlFor="new-project-name">{t("nameLabel")}</Label>
        <Input
          id="new-project-name"
          autoFocus={autoFocus}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          aria-label={t("nameLabel")}
        />
      </div>
      {onCancel ? (
        // 弹窗 Footer 配方（§9.4b）：取消 ghost + 创建 primary 右对齐
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" disabled={creating || !name.trim()}>
            {creating ? tCommon("creating") : tCommon("create")}
          </Button>
        </div>
      ) : (
        <Button type="submit" className="h-9 w-full" disabled={creating || !name.trim()}>
          {creating ? tCommon("creating") : tCommon("create")}
        </Button>
      )}
    </form>
  );
}
