import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn/ui 地基：className 合并约定（冲突时后者胜，变体可覆盖）
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * JSON 值深度相等（键序无关）。
 * 替代 JSON.stringify 直接比较：后者对键顺序敏感，同一文档属性顺序飘一下
 * 就被判不等，产生伪 UPDATE 活动/伪通知（issue 描述与 fieldValues diff 用）。
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (typeof b === "object") {
    if (Array.isArray(b)) return false;
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) => jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}
