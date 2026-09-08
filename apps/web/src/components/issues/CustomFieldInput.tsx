"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label as UILabel } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import MemberCombobox from "@/components/members/MemberCombobox";
import type { CustomFieldDTO, CustomFieldOption, MemberDTO } from "@/lib/client/api";
import { cn } from "@/lib/utils";

// 自定义字段值的通用控件（创建/详情/只读三处同源）。
// 存储值：TEXT/SELECT -> string，NUMBER -> number，DATE -> "YYYY-MM-DD"，
//         USER 单选 -> userId (string)，USER 多选 -> userId[]，清空 -> null。
// 选项：archived 的选项仅用于回显历史值（置灰、不可新选）。

export type FieldValues = Record<string, string | number | string[] | null>;

function optionOf(field: CustomFieldDTO, value: unknown): CustomFieldOption | undefined {
  if (!Array.isArray(field.options)) return undefined;
  return field.options.find((o) => o.value === value);
}

const NONE = "__none__"; // Radix Select 不支持空字符串 value，用哨兵表示“未设置”

/** USER/SELECT 字段是否多选（settings.multiple） */
function userFieldMultiple(f: CustomFieldDTO): boolean {
  const s = f.settings as { multiple?: boolean } | null | undefined;
  return s?.multiple === true;
}

export default function CustomFieldInput({
  field,
  value,
  onChange,
  members,
}: {
  field: CustomFieldDTO;
  value: string | number | string[] | null | undefined;
  onChange: (value: string | number | string[] | null) => void;
  /** USER 类型的候选成员（缺省时下拉为空列表——列表数据由页面数据源负责） */
  members?: MemberDTO[] | undefined;
}) {
  const t = useTranslations("issues");
  const options = (field.options ?? []).filter((o) => !o.archived);
  const current = value ?? "";
  const currentOption = field.type === "SELECT" ? optionOf(field, current) : undefined;
  // 历史值落在已归档选项上：补一个置灰项，保证回显不丢
  const orphanOption =
    field.type === "SELECT" && currentOption?.archived ? currentOption : undefined;

  return (
    <div className="space-y-1">
      <UILabel className="text-xs text-muted-foreground">
        {field.name}
        {field.isRequired && <span className="ml-0.5 text-destructive">*</span>}
      </UILabel>

      {field.type === "USER" ? (
        <div className="w-2/3">
          <MemberCombobox
          members={members}
          single={!userFieldMultiple(field)}
          // 多选 USER 字段 = 暂存语义（chips 会堆积，自动高全量展示）；单选 = 表单字段
          variant={userFieldMultiple(field) ? "staging" : "field"}
          selected={
            value === null || value === undefined || value === ""
              ? []
              : Array.isArray(value)
                ? value
                : [String(value)]
          }
          onChange={(ids) =>
            onChange(
              userFieldMultiple(field) ? (ids.length ? ids : null) : (ids[0] ?? null),
            )
          }
          placeholder={t("notSet")}
        />
        </div>
      ) : field.type === "SELECT" && userFieldMultiple(field) ? (
        <div className="flex max-w-md flex-wrap gap-1.5 pt-1.5">
          {options.map((o) => {
            const selected = Array.isArray(value) && value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  const cur = Array.isArray(value) ? value : [];
                  const next = selected
                    ? cur.filter((v) => v !== o.value)
                    : [...cur, o.value];
                  onChange(next.length ? next : null);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors",
                  selected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ background: o.color ?? "#94a3b8" }}
                />
                {o.label}
              </button>
            );
          })}
          {/* 历史值落在已归档选项上：置灰回显，但保留移除出口（点击即取消）——
              没有出口的话归档一个选项会把沾过它的多选值冻结成永久只读遗物，
              连"清空整个字段"都做不到，与单选的「未设置」路径不对称 */}
          {Array.isArray(value) &&
            value
              .filter(
                (v) => !options.some((o) => o.value === v),
              )
              .map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-label={t("removeArchivedOption", {
                    label: optionOf(field, v)?.label ?? v,
                  })}
                  title={t("removeArchivedOptionHint")}
                  onClick={() => {
                    const cur = value as string[];
                    const next = cur.filter((x) => x !== v);
                    onChange(next.length ? next : null);
                  }}
                  className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground opacity-60 hover:border-destructive hover:text-destructive"
                >
                  {t("archivedOption", { label: optionOf(field, v)?.label ?? v })}
                </button>
              ))}
        </div>
      ) : field.type === "SELECT" ? (
        <Select
          value={current === "" ? NONE : String(current)}
          onValueChange={(v) => onChange(v === NONE ? null : v)}
        >
          <SelectTrigger className="w-2/3">
            <SelectValue placeholder={t("notSet")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("notSet")}</SelectItem>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: o.color ?? "#94a3b8" }}
                  />
                  {o.label}
                </span>
              </SelectItem>
            ))}
            {orphanOption && (
              <SelectItem value={orphanOption.value} className="opacity-60">
                {t("archivedOption", { label: orphanOption.label })}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      ) : field.type === "DATE" ? (
        <Input
          type="date"
          value={current === "" ? "" : String(current)}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          className="h-9 w-2/3 text-sm"
        />
      ) : field.type === "NUMBER" ? (
        <Input
          type="number"
          value={current === "" ? "" : String(current)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          placeholder={t("notSet")}
          className="h-9 w-2/3 text-sm"
        />
      ) : (
        <Textarea
          value={current === "" ? "" : String(current)}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          placeholder={t("notSet")}
          rows={3}
          className={cn("w-2/3 text-sm")}
        />
      )}
    </div>
  );
}
