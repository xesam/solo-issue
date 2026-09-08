"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Bell, ListTodo, Monitor, Moon, Palette, Settings as SettingsIcon, Sun } from "lucide-react";
import { apiGet, apiPost, useNotifications } from "@/lib/client/api";
import { withBase } from "@/lib/base-path";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
DropdownMenuSub,
DropdownMenuSubContent,
DropdownMenuSubTrigger,
DropdownMenuRadioGroup,
DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import GlobalSearch from "@/components/search/GlobalSearch";
import LocaleSwitcher from "@/components/shell/LocaleSwitcher";
import { LogoFull } from "@/components/ui/logo";
import type { UserOrigin } from "@prisma/client";
import { credentialHint } from "@/lib/origin-labels";

// 顶栏（全局固定、三壳同构）：Logo / 搜索 / 徽标舱 / 头像+Admin。
// 职责划分（②' 决策）：顶栏管"跨层不变的服务"，侧栏管"本层身份与词汇"。
// 徽标舱 = 账号层常驻舱（决策 c）：数据源与工作台同 Key 共缓存，所有页面可见，点击回 /me。

// 账号层徽标数据：queryKey 必须与 Workbench 的「assigned + 全作用域」逐元素相等
// （["workbench", "assigned", null]），否则不是共享而是各打各的 30s 轮询
export function useAccountBadges() {
  const wb = useQuery({
    queryKey: ["workbench", "assigned", null],
    queryFn: () =>
      apiGet<{ stats: { assigned: number; created: number } }>("/api/workbench?tab=assigned"),
    refetchInterval: 30_000,
  });
  const notif = useNotifications();
  return {
    assigned: wb.data?.stats.assigned,
    created: wb.data?.stats.created,
    unread: notif.data?.unreadCount,
  };
}

function BadgeChip({
  href,
  label,
  count,
  icon: Icon,
}: {
  href: string;
  label: string;
  count: number | undefined;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link
      href={href}
      title={`${label}：${count ?? "…"}`}
      aria-label={`${label} ${count ?? ""}`}
      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="tabular-nums">{count === undefined ? "–" : count > 99 ? "99+" : count}</span>
    </Link>
  );
}

export default function TopBar({
  user,
  leading,
}: {
  user: { name: string; email?: string | null; origin?: UserOrigin | null; isAdmin?: boolean };
  leading?: React.ReactNode;
}) {
  const router = useRouter();
  const badges = useAccountBadges();
  const { theme, setTheme } = useTheme();
  const tTop = useTranslations("topbar");
  const tTheme = useTranslations("theme");
  const tLabels = useTranslations("labels");

  // 外观入口：设置域独立分区已下线，主题三选收敛在此子菜单（全站唯一入口）。
  const THEME_OPTIONS = [
    { value: "light", label: tTheme("light"), Icon: Sun },
    { value: "dark", label: tTheme("dark"), Icon: Moon },
    { value: "system", label: tTheme("system"), Icon: Monitor },
  ] as const;
  const currentTheme = theme ?? "system";

  async function handleLogout() {
    try {
      await apiPost("/api/auth/logout");
    } catch {
      // 登出接口失败也要继续走去登录页（cookie 清理由服务端尽力而为），
      // 但静默吞错会让用户"以为登出了"——先给提示
      toast.error(tTop("logoutFailed"));
      return;
    }
    window.location.href = withBase("/signin");
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
      {leading}
      {/* Logo 区：完整品牌 logo（图形 + 矢量字标），点击回账号层首页 */}
      <Link
        href="/me"
        title={tTop("myWork")}
        aria-label={tTop("myWork")}
        className="flex items-center rounded-md px-1 py-1 transition-colors hover:bg-accent"
      >
        <LogoFull className="h-6" />
      </Link>

      {/* 搜索胶囊靠右（GitLab 同款右置）：ml-auto 在此，右侧徽标舱不再另设 */}
      <GlobalSearch />

      <div className="flex items-center gap-0.5">
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-background px-0.5">
          <BadgeChip href="/me" label={tTop("assignedToMe")} count={badges.assigned} icon={ListTodo} />
          <BadgeChip href="/me" label={tTop("unreadNotifications")} count={badges.unread} icon={Bell} />
        </div>

        {user.isAdmin && (
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 px-2.5 text-sm text-muted-foreground"
            title={tTop("admin")}
            aria-label={tTop("admin")}
          >
            <Link href="/admin">{tTop("admin")}</Link>
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-8 items-center justify-center rounded-full outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={tTop("accountMenu", { name: user.name })}
            title={user.name}
          >
            <Avatar
              user={{ id: "", name: user.name, email: user.email ?? null, avatarUrl: null }}
              size={28}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <p className="truncate px-2.5 py-1.5 text-xs text-muted-foreground">{user.name}</p>
            {/* 凭据标识：本人来源/登录键，IM 账号可见「单通道」事实 */}
            {credentialHint(tLabels, user) && (
              <p className="truncate px-2.5 pb-1.5 text-xs text-muted-foreground/70">
                {credentialHint(tLabels, user)}
              </p>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="text-sm">
                <Palette className="size-4" aria-hidden />
                {tTheme("appearance")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={currentTheme}
                  onValueChange={(v) => setTheme(v as "light" | "dark" | "system")}
                >
                  {THEME_OPTIONS.map(({ value, label, Icon }) => (
                    <DropdownMenuRadioItem key={value} value={value} className="text-sm">
                      <Icon className="size-3.5" aria-hidden />
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <LocaleSwitcher />
            <DropdownMenuItem onClick={() => router.push("/settings")} className="text-sm">
              <SettingsIcon className="size-4" aria-hidden />
              {tTop("settings")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void handleLogout()}
              className="text-sm text-destructive focus:text-destructive"
            >
              {tTop("logout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
