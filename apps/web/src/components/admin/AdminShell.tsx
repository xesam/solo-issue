"use client";

import { Building2, Settings, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import ShellScaffold from "@/components/shell/ShellScaffold";
import { ShellIdentity } from "@/components/shell/ShellIdentity";
import { StaticNav } from "@/components/shell/StaticNav";

// 管理台外壳（「外壳按语境分，皮肤按全站统一」）。
// 改用 ShellScaffold（TopBar + 侧栏三段结构）——顶栏全局固定后，
// 管理台也获得徽标舱/账号弹层（管理台使用者同样是账号层的人）。
// 不进 WorkspaceShell（D1 正交：isAdmin 不穿透业务，硬套业务壳会出现「isAdmin 但 GUEST」
// 的权限矛盾与虚假工作区导航）。侧边栏内容是治理功能分区（非工作区/项目导航）。
// 折叠态键 admin_sidebar_collapsed（与业务壳语境独立，不互相同步）。

// 分区导航单源：新增管理分区 = 此数组加一行 + 建一个路由文件夹（layout 守卫自动覆盖）。
// 扩展位（不建空壳页面，见讨论定案②）：sessions 在线会话治理 / audit 操作审计 / settings 实例配置。
const ADMIN_NAV = [
  { href: "/admin/users", labelKey: "users", icon: Users },
  { href: "/admin/workspaces", labelKey: "workspaces", icon: Building2 },
] as const satisfies readonly { href: string; labelKey: string; icon: React.ComponentType<{ className?: string }> }[];

export default function AdminShell({
  user,
  children,
}: {
  user: { name: string; email?: string | null; origin?: import("@prisma/client").UserOrigin | null; isAdmin?: boolean };
  children: React.ReactNode;
}) {
  const t = useTranslations("admin");
  return (
    <ShellScaffold
      user={user}
      scope="admin"
      identity={(col) => (
        <ShellIdentity
          icon={Settings}
          title={t("adminTitle")}
          subtitle={t("adminSubtitle")}
          collapsed={!!col}
        />
      )}
      nav={(col, onNavigate) => (
        <StaticNav
          items={ADMIN_NAV.map((n) => ({ href: n.href, label: t(n.labelKey), icon: n.icon }))}
          collapsed={!!col}
          onNavigate={onNavigate}
        />
      )}
    >
      {children}
    </ShellScaffold>
  );
}
