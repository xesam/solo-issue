import type { CustomFieldDTO } from "@/lib/client/api";

// 自定义字段的纯展示辅助（列头/单元格共用）。
// 未用 React 组件——调用方自行包裹元素，便于表格与过滤器复用同一格式化逻辑。

const FIELD_TYPE_LABEL: Record<CustomFieldDTO["type"], string> = {
  TEXT: "typeText",
  NUMBER: "typeNumber",
  DATE: "typeDate",
  SELECT: "typeSelect",
  USER: "typeUser",
};

/** 含多选形态的类型标签：multiple 的 SELECT 显示「多选」 */
export function fieldTypeLabel(
  f: Pick<CustomFieldDTO, "type"> & { settings?: CustomFieldDTO["settings"] },
): string {
  return f.type === "SELECT" && f.settings?.multiple === true
    ? "typeMultiSelect"
    : FIELD_TYPE_LABEL[f.type];
}

type FieldOption = { value: string; label: string; color?: string; archived?: boolean };

function fieldOptions(f: CustomFieldDTO): FieldOption[] {
  return (f.options ?? []) as FieldOption[];
}

/** SELECT 值 → 选项标签（保留归档选项可读，历史值不因选项软删而失真；多选顿号连接——与服务端 registry.ts text() 同口径） */
function fieldOptionLabel(f: CustomFieldDTO, value: unknown): string | null {
  const label = (v: string) => {
    const o = fieldOptions(f).find((x) => x.value === v);
    return o ? o.label : v;
  };
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === "string").map(label).join("、");
  if (typeof value !== "string") return null;
  return label(value);
}

export function fieldOptionColor(f: CustomFieldDTO, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return fieldOptions(f).find((x) => x.value === value)?.color;
}

/** 任意字段值 → 单元格文本；空值返回 null 由调用方渲染占位符。
 *  resolveUser：USER 类型的 userId → 显示名（缺省时回退 id 前 6 位，避免泄漏完整 id） */
export function formatFieldValue(
  f: CustomFieldDTO,
  value: unknown,
  resolveUser?: (id: string) => string | undefined,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (f.type === "SELECT") return fieldOptionLabel(f, value);
  if (f.type === "USER") {
    const ids = Array.isArray(value) ? value : [value];
    const names = ids
      .filter((v): v is string => typeof v === "string")
      .map((id) => resolveUser?.(id) ?? `${id.slice(0, 6)}…`);
    return names.length ? names.join(", ") : null;
  }
  return String(value);
}
