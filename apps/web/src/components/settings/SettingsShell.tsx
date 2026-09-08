"use client";

import { KeyRound, Settings, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import ShellScaffold from "@/components/shell/ShellScaffold";
import { ShellIdentity } from "@/components/shell/ShellIdentity";
import { StaticNav } from "@/components/shell/StaticNav";

// 设置外壳（/account 单页平铺升格为 /settings 全站个人偏好域）。
// 改用 ShellScaffold——顶栏全局固定后全局搜索/徽标舱同样覆盖设置域；
// 实际账号操作入口（账号/设置/退出）在顶栏头像弹层，等功能域默认页即账号页。
// 折叠态键 settings_sidebar_collapsed（与业务壳/管理台语境独立，不互相同步）。
// 主题切换收敛在顶栏账号弹层「外观」子菜单（全站唯一入口），外壳不放 ThemeToggle。

// 分区导航单源：新增偏好分区 = 此数组加一行 + 建一个路由文件夹（layout 守卫自动覆盖）。
// 扩展位（不建空壳页面）：notifications 通知偏好 / language 语言。
const SETTINGS_NAV = [
  { href: "/settings/account", labelKey: "account", icon: UserRound },
  { href: "/settings/tokens", labelKey: "apiTokens", icon: KeyRound },
] as const satisfies readonly { href: string; labelKey: string; icon: React.ComponentType<{ className?: string }> }[];

export default function SettingsShell({
  user,
  children,
}: {
  user: { name: string; email?: string | null; origin?: import("@prisma/client").UserOrigin | null; isAdmin?: boolean };
  children: React.ReactNode;
}) {
  const t = useTranslations("settings");
  return (
    <ShellScaffold
      user={user}
      scope="settings"
      identity={(col) => (
        <ShellIdentity
          icon={Settings}
          title={t("settingsTitle")}
          subtitle={t("settingsSubtitle")}
          collapsed={!!col}
        />
      )}
      nav={(col, onNavigate) => (
        <StaticNav
          items={SETTINGS_NAV.map((n) => ({ href: n.href, label: t(n.labelKey), icon: n.icon }))}
          collapsed={!!col}
          onNavigate={onNavigate}
        />
      )}
    >
      {children}
    </ShellScaffold>
  );
}
