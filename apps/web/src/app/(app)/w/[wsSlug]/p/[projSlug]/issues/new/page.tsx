import { pageProject } from "@/server/auth/pages";
import CreateIssuePage from "@/components/issues/CreateIssuePage";

export const dynamic = "force-dynamic";

// 创建问题（页面模式）：独立 URL，可刷新/分享
export default async function NewIssuePage({
  params,
}: {
  params: Promise<{ wsSlug: string; projSlug: string }>;
}) {
  const { wsSlug, projSlug } = await params;
  const { project } = await pageProject(wsSlug, projSlug);

  return (
    <CreateIssuePage
      wsSlug={wsSlug}
      projectSlug={projSlug}
      projectName={project.name}
      projectId={project.id}
      projectIsPrivate={project.isPrivate}
    />
  );
}
