import { getUserContext } from "@/server/auth/pages";
import AccountShell from "@/components/account/AccountShell";

export const dynamic = "force-dynamic";

// 账号层布局：/me 使用 AccountShell（“你的工作”层），
// 与工作区壳平级、同构（ShellScaffold 骨架），不再寄住于 /w/:slug 之下。
export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const { user } = await getUserContext();
  return (
    <AccountShell
      user={{ name: user.name, email: user.email, origin: user.origin, isAdmin: user.isAdmin }}
    >
      {children}
    </AccountShell>
  );
}
