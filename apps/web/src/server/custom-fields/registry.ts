// 自定义字段类型注册表（Strapi 式：类型 = 校验 + 展示的注册单元）
//
// 新增一种字段类型 = 在 TYPES 里加一项；字段 CRUD / Issue 写入 / Activity 文案
// 全部自动生效，不需要在多个地方散写 if。
//
// 存储约定：值存在 Issue.fieldValues（JSONB），key -> value；null 表示"清空"。

import { HttpError } from "@/lib/api";
import type { CustomField, FieldType } from "@prisma/client";

/** 字段值：标量或字符串数组（USER 多选） */
type StoredFieldValue = string | number | string[] | null;

export type SelectOption = {
  value: string;
  label: string;
  color?: string;
  archived?: boolean; // 选项软删：存量值仍有效，仅不再可选
};

type TypeDef = {
  /** 校验并归一化单个值（抛 HttpError 422）——仅形状/类型，不含异步可见性校验 */
  validate(value: unknown, field: CustomField): string | number | string[];
  /** 人类可读文案（Activity / IM 摘要 / UI 只读展示） */
  text(value: unknown, field: CustomField): string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const TYPES: Record<FieldType, TypeDef> = {
  TEXT: {
    validate(value, field) {
      if (typeof value !== "string") throw new HttpError(422, "errors.fieldNeedsText", undefined, { field: field.name });
      const v = value.trim();
      if (!v.length) throw new HttpError(422, "errors.fieldCannotBeEmpty", undefined, { field: field.name });
      if (v.length > 2000) throw new HttpError(422, "errors.fieldTooLong", undefined, { field: field.name, max: 2000 });
      return v;
    },
    text: (v) => (typeof v === "string" ? v : String(v)),
  },
  NUMBER: {
    validate(value, field) {
      const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n))
        throw new HttpError(422, "errors.fieldNeedsNumber", undefined, { field: field.name });
      return n;
    },
    text: (v) => String(v),
  },
  DATE: {
    validate(value, field) {
      if (typeof value !== "string" || !DATE_RE.test(value) || Number.isNaN(Date.parse(value)))
        throw new HttpError(422, "errors.fieldNeedsDate", undefined, { field: field.name });
      // 日历合法性：Date.parse 对日溢出做进位（"2024-02-30" → 3 月 1 日），
      // 回读比对拦掉不存在的日历日期
      if (new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value)
        throw new HttpError(422, "errors.fieldNeedsDate", undefined, { field: field.name });
      return value;
    },
    text: (v) => (typeof v === "string" ? v : String(v)),
  },
  SELECT: {
    validate(value, field) {
      const multiple = selectFieldMultiple(field);
      if (multiple) {
        if (!Array.isArray(value)) throw new HttpError(422, "errors.fieldNeedsOptionArray", undefined, { field: field.name });
        if (!value.length) throw new HttpError(422, "errors.fieldCannotBeEmpty", undefined, { field: field.name });
        const active = new Set(activeSelectOptions(field).map((o) => o.value));
        for (const v of value) {
          if (typeof v !== "string" || !v)
            throw new HttpError(422, "errors.fieldOptionValueInvalid", undefined, { field: field.name });
          if (!active.has(v)) throw new HttpError(422, "errors.fieldValueNotInOptions", undefined, { field: field.name });
        }
        // 去重，保持首次出现顺序
        return [...new Set(value as string[])];
      }
      if (typeof value !== "string") throw new HttpError(422, "errors.fieldNeedsOptionText", undefined, { field: field.name });
      const opt = activeSelectOptions(field).find((o) => o.value === value);
      // 已软删的选项：存量值仍合法（历史值不变非法），但**不可再被新写入**。
      // 需要“保留旧值”的场景由调用方传入 prevValues 走 allowArchived 分支（见 validateFieldValues）。
      if (!opt) throw new HttpError(422, "errors.fieldValueNotInOptions", undefined, { field: field.name });
      return value;
    },
    text(value, field) {
      const labels = (vs: string[]) =>
        vs.map((v) => selectOptions(field).find((o) => o.value === v)?.label ?? v);
      if (Array.isArray(value)) return labels(value).join("、");
      const opt = selectOptions(field).find((o) => o.value === value);
      return opt ? opt.label : String(value);
    },
  },
  // USER：值 = workspace 成员 userId。形状校验在此；成员可见性校验在服务层（异步、需项目上下文）
  USER: {
    validate(value, field) {
      if (userFieldMultiple(field)) {
        if (!Array.isArray(value)) throw new HttpError(422, "errors.fieldNeedsUserIds", undefined, { field: field.name });
        if (!value.length) throw new HttpError(422, "errors.fieldCannotBeEmpty", undefined, { field: field.name });
        for (const v of value)
          if (typeof v !== "string" || !v.trim())
            throw new HttpError(422, "errors.fieldUserIdInvalid", undefined, { field: field.name });
        // 去重，保持首次出现顺序
        return [...new Set(value as string[])];
      }
      if (typeof value !== "string" || !value.trim())
        throw new HttpError(422, "errors.fieldNeedsUserId", undefined, { field: field.name });
      return value;
    },
    text: (v) =>
      Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : String(v),
  },
};

/** USER 字段是否多选（settings.multiple） */
function userFieldMultiple(field: { settings?: unknown }): boolean {
  return selectOrUserMultiple(field);
}

/** SELECT/USER 字段是否多选（settings.multiple） */
export function selectOrUserMultiple(field: { settings?: unknown }): boolean {
  const s = field.settings;
  return !!s && typeof s === "object" && (s as { multiple?: unknown }).multiple === true;
}

/** SELECT 字段是否多选（settings.multiple，与 USER 同一约定） */
const selectFieldMultiple = selectOrUserMultiple;

/** 从任意字段值中提取 userId 列表（兼容单选/多选/空值），供通知与展示层复用 */
export function userIdsOfFieldValue(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && !!v);
  return [];
}

/** 一次性校验中涉及的 USER 字段值集合（供服务层做成员可见性护栏） */
export function userFieldIdentifiers(fields: CustomField[], values: Record<string, unknown>) {
  const out: { field: CustomField; userIds: string[] }[] = [];
  for (const f of fields) {
    if (f.type !== "USER") continue;
    const ids = userIdsOfFieldValue(values[f.key]);
    if (ids.length) out.push({ field: f, userIds: ids });
  }
  return out;
}

/** SELECT 选项（含已软删，供历史值回显） */
function selectOptions(field: { options: unknown }): SelectOption[] {
  if (!Array.isArray(field.options)) return [];
  return (field.options as unknown[]).filter(
    (o): o is SelectOption =>
      !!o && typeof o === "object" && typeof (o as SelectOption).value === "string",
  );
}

/** 当前可选（未软删）的选项 */
export function activeSelectOptions(field: CustomField): SelectOption[] {
  return selectOptions(field).filter((o) => !o.archived);
}

function typeDef(field: CustomField): TypeDef {
  const def = TYPES[field.type];
  if (!def) throw new HttpError(500, "errors.unknownFieldType", undefined, { type: field.type });
  return def;
}

export function fieldText(field: CustomField, value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeDef(field).text(value, field);
}

/**
 * 校验并归一化一次写入的 fieldValues。
 *
 * - enforceRequired=true（创建）：必填字段缺失即报错
 * - enforceRequired=false（更新）：只校验显式提供的 key；已存在但未提供的必填字段不追溯
 *   （存量豁免：字段改为必填时，历史 issue 不被追溯拦截）
 * - 显式 null 与空串：均表示清空；必填字段不允许清空
 * - 未知 key 一律 422（防止定义漂移期间写入幽灵数据）
 * - prevValues：现有值。传入后，值为「已软删选项且与原值相同」时放行
 *   （历史值不得因选项软删而变得不可保存）；新设一个已软删选项仍 422。
 */
export function validateFieldValues(
  fields: CustomField[],
  input: Record<string, unknown> | null | undefined,
  opts: { enforceRequired: boolean; prevValues?: Record<string, unknown> | null },
): Record<string, StoredFieldValue> {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out: Record<string, StoredFieldValue> = {};

  for (const f of fields) {
    const v = input?.[f.key];
    if (v === undefined) {
      if (opts.enforceRequired && f.isRequired)
        throw new HttpError(422, "errors.fieldRequired", undefined, { field: f.name });
      continue;
    }
    if (v === null || v === "") {
      if (f.isRequired)
        throw new HttpError(422, "errors.fieldRequiredCannotClear", undefined, { field: f.name });
      out[f.key] = null;
      continue;
    }
    // 已软删选项的存量值：仅当未变化时放行（保持历史值可保存，不允许新选）。
    // SELECT 单选/多选通用：值必须命中活动选项，否则须是「已软删且与原值相同」的存量项。
    // 放行分支只对形状与选项模式相称的值开放（单选=string、多选=string[]）——
    // 形状不符（如单选收数组）不允许经此旁路落库，落回类型闸 422
    if (f.type === "SELECT" && opts.prevValues != null) {
      const multiple = selectFieldMultiple(f);
      const prev = opts.prevValues[f.key];
      const prevSet = new Set(userIdsOfFieldValue(prev)); // 通用标量/数组提取
      const passthrough = (v: string) =>
        !activeSelectOptions(f).some((o) => o.value === v) &&
        selectOptions(f).some((o) => o.value === v) &&
        prevSet.has(v);
      if (multiple && Array.isArray(v) && v.every((x) => typeof x === "string")) {
        const active = new Set(activeSelectOptions(f).map((o) => o.value));
        const kept = (v as string[]).filter((x) => active.has(x) || passthrough(x));
        if (kept.length === v.length) {
          out[f.key] = [...new Set(kept)];
          continue;
        }
      }
      if (!multiple && typeof v === "string" && passthrough(v)) {
        out[f.key] = v;
        continue;
      }
    }
    out[f.key] = typeDef(f).validate(v, f);
  }

  const unknown = Object.keys(input ?? {}).filter((k) => !byKey.has(k));
  if (unknown.length) throw new HttpError(422, "errors.unknownFields", undefined, { keys: unknown.join(", ") });

  return out;
}
