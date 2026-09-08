import { Suspense } from "react";
import { pageProject } from "@/server/auth/pages";
import ProjectSettingsPage from "@/components/project/ProjectSettingsPage";
import { Skeleton } from "@/components/ui/skeleton";

export const dynamic = "force-dynamic";

// 项目设置页：弹窗 → 页面级，长列表管理不再受限于 70vh 弹窗内滚动。
// 权限双闸：写入按 requireProjectWrite（状态表）；访问/成员/私有按 requireProjectAdmin（项目负责人 ∨ 工作区负责人）。
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ wsSlug: string; projSlug: string }>;
}) {
  const { wsSlug, projSlug } = await params;
  const { project, member, projectMemberRole } = await pageProject(wsSlug, projSlug);

  return (
    <Suspense
      fallback={
        <div className="space-y-4 px-8 py-6">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <ProjectSettingsPage
        projectId={project.id}
        wsSlug={wsSlug}
        projectSlug={project.slug}
        projectName={project.name}
        projectIsPrivate={project.isPrivate}
        canManage={member.role === "OWNER" || projectMemberRole === "ADMIN"}
      />
    </Suspense>
  );
}
