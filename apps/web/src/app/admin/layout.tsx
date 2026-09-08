import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import AdminShell from "@/components/admin/AdminShell";

export const dynamic = "force-dynamic";

// 管理台布局：isAdmin 守卫在此写一次，自动覆盖全部子路由
// （超管与业务正交——实例管理不穿透业务，只管用户与配置；API 层另有 requireInstanceAdmin 纵深防御）。
// 非管理员直接回账号层首页（不暴露管理台）。

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (!user.isAdmin) redirect("/me");
  // 强制改密态同 settings 壳口径：壳层先短路，数据面由 requireApiUser 403 纵深兜底
  if (user.mustChangePassword) redirect("/change-password");
  return (
    <AdminShell user={{ name: user.name, email: user.email, origin: user.origin, isAdmin: user.isAdmin }}>
      {children}
    </AdminShell>
  );
}
