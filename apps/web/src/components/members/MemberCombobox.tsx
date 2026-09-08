"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, X } from "lucide-react";
import type { MemberDTO } from "@/lib/client/api";
import { credentialHint } from "@/lib/origin-labels";
import { Avatar } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

// 成员多选器。列表项 = 头像 + 姓名 + 凭据标识（IM 账号显来源、
// 邮箱账号显邮箱，均为重名辨析服务），可按姓名/凭据标识过滤（cmdk 内建）。
//
// 布局语义走 variant（2026-09-30 定案）：高度/截断策略按语义分档声明——
//   field   —— 表单整行字段：h-9 固定，chips 截 6 + "+N"
//   staging —— 暂存区（选完待提交）：自动高、chips 全量展示（选中即候审，必须可见）
// className 仍会拼接（真·外层布局用），variant 语义约束靠评审 + audit-ui 维持，
// 并非机制强制——勿用 className 覆写高度/截断。
// 前史：基类曾把 h-9/w-full/截断上下文焊死，调用点各自 className 打补丁，先后制造
// chips 竞态消失、"+N" 显示不全、chips 换行撑破、w-full 顶出容器四类缺陷。

export default function MemberCombobox({
  members,
  selected,
  onChange,
  placeholder,
  variant = "field",
  className,
  knownUsers = [],
  single,
  disabled,
}: {
  members: MemberDTO[] | undefined;
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  // 语义变体（field=表单字段/staging=暂存区），决定高度与 chips 截断策略
  variant?: "field" | "staging";
  className?: string;
  // 单选模式（USER 字段 multiple=false）：选中即关闭，再次点击取消
  single?: boolean;
  // 整器只读（批量工具条忙时/超限时锁定）；chips 的移除出口同步关闭
  disabled?: boolean;
  // 已知选中用户的完整信息（如 issue.assignees 的 user）：
  // members 查询未返回时也先能渲染 chips，避免首屏竞态下已选信息消失
  knownUsers?: { id: string; name: string; email?: string | null; avatarUrl?: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("members");
  const tLabels = useTranslations("labels");
  const list = members ?? [];
  const staging = variant === "staging";
  const chipLimit = staging ? Infinity : 6;
  const byId = new Map([
    ...knownUsers.map((u) => [u.id, { user: u }] as const),
    ...list.map((m) => [m.user.id, m] as const),
  ]);
  const chosen = selected.map((id) => byId.get(id)).filter(Boolean) as MemberDTO[];
  const resolvedPlaceholder = placeholder ?? t("selectMember");

  function toggle(id: string) {
    if (single) {
      onChange(selected.includes(id) ? [] : [id]);
      setOpen(false);
      return;
    }
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <Popover open={disabled ? false : open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "min-w-0 justify-between bg-white font-normal dark:bg-input/30",
            staging ? "h-auto min-h-8 w-full items-start py-1" : "h-9 w-full",
            !chosen.length && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {chosen.length ? (
              chosen.slice(0, chipLimit).map((m) => (
                <span
                  key={m.user.id}
                  className="inline-flex items-center gap-1 rounded-full bg-muted pl-0.5 pr-2 text-xs"
                >
                  <Avatar user={m.user} size={18} />
                  {m.user.name}
                  {/* 触发器本身是 <button>，这里必须用非按钮元素（button 嵌 button 是非法 DOM）；
                      stopPropagation 保证点 X 只移除选中、不触发弹层开合 */}
                   <span
                     role="button"
                     tabIndex={disabled ? -1 : 0}
                     aria-label={t("removeMember", { name: m.user.name })}
                    className={cn(
                      "cursor-pointer rounded-full text-muted-foreground/60 hover:text-foreground",
                      disabled && "pointer-events-none opacity-40",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (disabled) return;
                      toggle(m.user.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        if (disabled) return;
                        toggle(m.user.id);
                      }
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </span>
              ))
            ) : (
              resolvedPlaceholder
            )}
            {chosen.length > chipLimit && (
              <span className="text-xs text-muted-foreground">
                +{chosen.length - chipLimit}
              </span>
            )}
          </span>
          <ChevronsUpDown className="ml-1 size-3.5 shrink-0 text-muted-foreground/60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("searchPlaceholder")} />
          <CommandList>
            <CommandEmpty>{t("noMatch")}</CommandEmpty>
            <CommandGroup>
              {list.map((m) => {
                const active = selected.includes(m.user.id);
                return (
                  <CommandItem
                    key={m.user.id}
                    value={`${m.user.name} ${credentialHint(tLabels, m.user) ?? ""}`}
                    onSelect={() => toggle(m.user.id)}
                  >
                    <Avatar user={m.user} size={22} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{m.user.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {credentialHint(tLabels, m.user)}
                      </span>
                    </span>
                    <Check
                      className={cn(
                        "size-4 shrink-0 text-primary",
                        !active && "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
