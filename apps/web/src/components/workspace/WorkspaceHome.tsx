"use client";

import Workbench from "@/components/workbench/Workbench";
import CreateProjectDialog from "@/components/workspace/CreateProjectDialog";
import PageHeader from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

// /w/[wsSlug] 工作区落地页（方案 A）：任务列表为主体（待我处理 / 我创建的，固定本工作区），
// 项目选择/切换完全交给侧边栏 ProjectNav；通知中心留在 /me。
// 新建项目：页面级入口为 CreateProjectDialog 弹出框（UI 验收定案，弃内联展开；
// MEMBER/GUEST 无权限时不渲染任何创建入口）。

export default function WorkspaceHome({
  wsSlug,
  wsName,
  canCreateProject = false,
}: {
  wsSlug: string;
  wsName: string;
  canCreateProject?: boolean;
}) {
  const t = useTranslations("workspace");
  return (
    <div className="px-8 py-6">
      <PageHeader title={t("tasksTitle")} className="mb-6 items-end">
        {canCreateProject && (
          <CreateProjectDialog wsSlug={wsSlug} wsName={wsName}>
            <Button size="sm" className="gap-1.5">
              <Plus className="size-3.5" />
              {t("newProject")}
            </Button>
          </CreateProjectDialog>
        )}
      </PageHeader>

      <Workbench variant="workspace" wsScope={wsSlug} wsName={wsName} />
    </div>
  );
}
