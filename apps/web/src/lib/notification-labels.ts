import type { Translator } from "@/i18n/config";

// 通知类型标签（客户端使用；切勿引入服务端依赖）。
// i18n：label 不再内置文案，调用方传 t（namespace 固定 labels.notificationType）

const TYPE_KEYS = ["ASSIGNED", "MENTIONED", "COMMENTED", "STATE_CHANGED"] as const;

export function typeLabel(t: Translator, type: string) {
  return (TYPE_KEYS as readonly string[]).includes(type) ? t(type) : type;
}
