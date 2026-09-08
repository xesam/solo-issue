// 字段级通知规则（afterWrite 钩子）的 DSL 定义——唯一定义点。
// 规则存 CustomField.settings.notifyOn：
//   { "values": ["critical"], "notify": ["PROJECT_LEAD", "FIELD_USERS"] }
// - 仅在值「变为」values 内某个值时触发（更新路径中字段从无到有亦算「变为」；
//   创建（createIssue）不接此钩子）
// - PROJECT_LEAD = 项目 lead；FIELD_USERS = USER 类型字段的被指派人
// - 操作者本人由调用处排除
// （暴露给 Agent 的自描述经 /fields/schema 的 x-fields.settings 原样携带本结构）

export const NOTIFY_PROJECT_LEAD = "PROJECT_LEAD";
export const NOTIFY_FIELD_USERS = "FIELD_USERS";

export type NotifyRule = { values: string[]; notify: string[] };

/** 读取字段的 notifyOn 规则；无规则/结构不合法/成员未知/类型不支持/值不命中 → null（惰性忽略，不抛错） */
export function notifyRuleFor(
  field: { type?: string; settings?: unknown } | undefined,
  value: unknown,
): NotifyRule | null {
  if (!field) return null;
  // DSL 承诺面仅 TEXT/SELECT/USER（docs/05 §5.2）；其他类型的规则配置
  // （只能经 API 旁路写入产生）不触发——与字段编辑器的可配面同口径
  if (field.type !== "TEXT" && field.type !== "SELECT" && field.type !== "USER") return null;
  const o = field.settings as { notifyOn?: NotifyRule } | null | undefined;
  const rule = o?.notifyOn;
  if (!rule || !Array.isArray(rule.values) || !rule.values.length) return null;
  if (!Array.isArray(rule.notify) || !rule.notify.length) return null;
  // settings 是 Json 列，除写入侧 zod 外还需自防 DB 直改/Agent 旁路写入的
  // 未知成员——不校验会让 TYPO 静默绕过所有收件人分支，通知归零且无痕
  const known = new Set<string>([NOTIFY_PROJECT_LEAD, NOTIFY_FIELD_USERS]);
  if (!rule.notify.every((t) => known.has(t))) return null;
  if (!rule.values.every((v) => typeof v === "string")) return null;
  const hit =
    typeof value === "string"
      ? rule.values.includes(value)
      : Array.isArray(value)
        ? value.some((v) => typeof v === "string" && rule.values.includes(v))
        : false;
  return hit ? rule : null;
}
