"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import CreateProjectForm from "@/components/workspace/CreateProjectForm";

// 新建项目弹出框：Dialog 承载（UI 验收定案，替代旧内联展开）。
// 表单体仍复用 CreateProjectForm 单源（WorkspaceHome 页面入口与侧栏 ProjectNav 共用本壳）；
// trigger 由调用方以 children 传入（按钮/图标形态各异）。

export default function CreateProjectDialog({
  wsSlug,
  wsName,
  children,
}: {
  wsSlug: string;
  wsName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("workspace");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild onClick={(e) => e.stopPropagation()}>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-left">{t("newProject")}</DialogTitle>
          <DialogDescription className="text-left">
            {t("createProjectDesc", { ws: wsName ?? t("currentWorkspace") })}
          </DialogDescription>
        </DialogHeader>
        <CreateProjectForm
          wsSlug={wsSlug}
          autoFocus
          onCreated={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
