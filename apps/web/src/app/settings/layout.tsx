import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import SettingsShell from "@/components/settings/SettingsShell";

export const dynamic = "force-dynamic";

// 设置域外壳与守卫（原 /account 单页的守卫语义上移至此，四个分区页自动覆盖）：
// 未登录 → 登录页；首登强制改密 → /change-password。
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  if (user.mustChangePassword) redirect("/change-password");
  return (
    <SettingsShell user={{ name: user.name, email: user.email, origin: user.origin, isAdmin: user.isAdmin }}>
      {children}
    </SettingsShell>
  );
}
