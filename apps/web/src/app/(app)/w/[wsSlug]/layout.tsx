import { pageContext } from "@/server/auth/pages";
import WorkspaceShell from "@/components/workspace/WorkspaceShell";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ wsSlug: string }>;
}) {
  const { wsSlug } = await params;
  const { user, workspace, member } = await pageContext(wsSlug);

  return (
    <WorkspaceShell
      user={{ id: user.id, name: user.name, email: user.email, origin: user.origin, isAdmin: user.isAdmin }}
      canCreateProject={member.role !== "MEMBER" && member.role !== "GUEST"}
      workspace={{ slug: workspace.slug, name: workspace.name }}
    >
      {children}
    </WorkspaceShell>
  );
}
