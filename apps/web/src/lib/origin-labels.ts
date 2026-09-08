import type { UserOrigin } from "@prisma/client";
import type { Translator } from "@/i18n/config";

// 来源 label 单源映射：内部枚举值上屏前必须过映射（ui-guidelines §6.2）。
// 新渠道 = UserOrigin 枚举加一行 + messages labels.origin 加一条。
// i18n：文案键固定在 labels 命名空间下，t 由调用方注入（客户端 useTranslations("labels")）

// 渠道名（labels.origin.*）
export function originLabel(t: Translator, origin: UserOrigin): string {
  return t(`origin.${origin}`);
}

// 凭据标识槽位：原 email 展示位的统一替身——
// IM 建号账号显示建号渠道（出生时无邮箱；管理台补写邮箱开通密码通道后此槽仍显示渠道），
// 邮箱建号账号保留 email 文本（其登录键）。
export function credentialHint(
  t: Translator,
  user: { email?: string | null; origin?: UserOrigin | null },
): string | null {
  if (user.origin && user.origin !== "EMAIL") {
    return originLabel(t, user.origin);
  }
  return user.email ?? null;
}

// 密码通道判据（账号能力级）：邮箱+密码是复合登录凭据（email 定位 + passwordHash 验证），
// 任一缺失即"无法通过邮箱密码登录"。修改密码是账号级凭据操作，与本次会话从哪个渠道登入无关
//（Session 不记录登录渠道，判据随账号走；不按 origin 判——出生渠道与可登录渠道正交，D5）。
export function hasPasswordChannel(user: {
  email?: string | null;
  passwordHash?: string | null;
}): boolean {
  return !!user.email && !!user.passwordHash;
}

// 修改密码禁用态提示（无密码通道账号用）。“渠道名”由调用方以 params 注入（labels.passwordHint.*）
export function passwordDisableHint(
  t: Translator,
  user: { origin?: UserOrigin | null },
): string {
  if (user.origin && user.origin !== "EMAIL") {
    return t("passwordHint.viaChannel", { channel: originLabel(t, user.origin) });
  }
  return t("passwordHint.noPassword");
}
