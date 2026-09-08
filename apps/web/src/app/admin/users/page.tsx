import { getSessionUser } from "@/server/auth/session";
import { redirect } from "next/navigation";
import UsersPanel from "@/components/admin/UsersPanel";

export const dynamic = "force-dynamic";

// 用户治理：搜索/过滤/分页 / 建号 / 停用启用 / 授撤超管 / 重置密码 / 工作区角色。
// 守卫见 ../layout.tsx；此处取 session 仅为给用户表标记「（我）」。

export default async function AdminUsersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  return <UsersPanel currentUserId={user.id} />;
}
