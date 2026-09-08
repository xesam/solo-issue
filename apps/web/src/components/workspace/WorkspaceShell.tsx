"use client";

import type { UserOrigin } from "@prisma/client";
import WorkspaceSwitcher from "@/components/workspace/WorkspaceSwitcher";
import ProjectNav from "@/components/workspace/ProjectNav";
import ShellScaffold from "@/components/shell/ShellScaffold";

// 工作区壳改用 ShellScaffold 骨架（顶栏服务舱 + 侧栏三段结构）。
// 侧栏：① 本层身份 = WorkspaceSwitcher（台上说“你在工作区 A”）② 本层词汇 = ProjectNav。
// 裁撤：侧栏“个人工作台”入口移除——职能由顶栏徽标舱承担（点击回 /me）。
// 裁撤（顶栏化）：账号头像/管理台/通知入口不再挂侧栏底部，全局搜索迁至顶栏。
// 底部只剩收起/展开（Scaffold 内置）。

export default function WorkspaceShell({
  user,
  workspace,
  canCreateProject = false,
  children,
}: {
  user: { id: string; name: string; email: string | null; origin?: UserOrigin | null; isAdmin?: boolean };
  workspace: { slug: string; name: string };
  canCreateProject?: boolean;
  children: React.ReactNode;
}) {
  return (
    <ShellScaffold
      user={{ name: user.name, email: user.email, origin: user.origin, isAdmin: user.isAdmin }}
      identity={(col) => (
        <WorkspaceSwitcher currentSlug={workspace.slug} currentName={workspace.name} collapsed={col} />
      )}
      nav={(col, onNavigate) => (
        <ProjectNav
          wsSlug={workspace.slug}
          userId={user.id}
          canCreateProject={canCreateProject}
          collapsed={col}
          onNavigate={onNavigate}
        />
      )}
    >
      {children}
    </ShellScaffold>
  );
}
