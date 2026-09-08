import { pageContext } from "@/server/auth/pages";
import WorkspaceHome from "@/components/workspace/WorkspaceHome";

export const dynamic = "force-dynamic";

// 工作区首页（切换工作区后的落地页）：任务列表（待我处理 / 我创建的），
// 项目选择/切换交给侧边栏。canCreateProject 与 layout（WorkspaceShell）同一判式，
// 同服务端 requireWorkspaceAdmin：OWNER 可建项目，MEMBER/GUEST 不渲染创建入口。

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ wsSlug: string }>;
}) {
  const { wsSlug } = await params;
  const { workspace, member } = await pageContext(wsSlug);
  return (
    <WorkspaceHome
      wsSlug={wsSlug}
      wsName={workspace.name}
      canCreateProject={member.role !== "MEMBER" && member.role !== "GUEST"}
    />
  );
}
