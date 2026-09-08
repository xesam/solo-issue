import WorkspacesPanel from "@/components/admin/WorkspacesPanel";

export const dynamic = "force-dynamic";

// 工作区治理：列表 / 新建 / 重命名 / 成员管理（与用户页角色列对等的另一方向）。守卫见 ../layout.tsx。

export default function AdminWorkspacesPage() {
  return <WorkspacesPanel />;
}
