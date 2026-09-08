"use client";

import type { State } from "@prisma/client";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// 状态选择（创建/编辑共用）：单一来源维护「无状态」占位与候选项渲染，
// 防止两套表单的状态下拉逻辑漂移。
//
// 语义约定（与旧实现一致）：
// - value 传 stateId；空串 = 无状态
// - showNone：是否渲染「无状态」项。编辑页恒有；创建页仅当项目无 isDefault
//   状态时显示（此时服务端不传 stateId 也只会落 null，占位项与真实行为严格一致）

export default function IssueStateSelect({
  states,
  value,
  onChange,
  showNone,
  size = "sm",
}: {
  states: State[] | undefined;
  value: string; // stateId；"" = 无状态
  onChange: (stateId: string) => void;
  showNone: boolean;
  size?: "sm" | "default";
}) {
  const t = useTranslations("issues");
  return (
    <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
      <SelectTrigger size={size} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {showNone && <SelectItem value="none">{t("noState")}</SelectItem>}
        {states?.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
