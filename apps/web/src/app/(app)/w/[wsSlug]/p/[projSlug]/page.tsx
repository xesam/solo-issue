import { Suspense } from "react";
import { pageProject } from "@/server/auth/pages";
import { canWriteWithRoles } from "@/server/auth/project-visibility";
import ProjectView from "@/components/project/ProjectView";
import { Skeleton } from "@/components/ui/skeleton";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ wsSlug: string; projSlug: string }>;
}) {
  const { wsSlug, projSlug } = await params;
  const { project, member, projectMemberRole } = await pageProject(wsSlug, projSlug);
  const canWrite = canWriteWithRoles(member.role, projectMemberRole);

  return (
    <Suspense
      fallback={
        <div className="space-y-4 px-8 py-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <ProjectView
        wsSlug={wsSlug}
        projectId={project.id}
        projectSlug={project.slug}
        projectName={project.name}
        canWrite={canWrite}
      />
    </Suspense>
  );
}
