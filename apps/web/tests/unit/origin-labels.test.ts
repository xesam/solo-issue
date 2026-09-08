import { describe, expect, it } from "vitest";
import type { Translator } from "@/i18n/config";
import {
  credentialHint,
  hasPasswordChannel,
  originLabel,
  passwordDisableHint,
} from "@/lib/origin-labels";

// Translator 伪实现：回显 key 与 params（registry 层只关心键与插值不通透传）
const t: Translator = (key, params) => (params ? `${key}|${JSON.stringify(params)}` : key);

describe("originLabel", () => {
  it("渠道枚举一律过 labels.origin.* 映射（内部值不上屏）", () => {
    expect(originLabel(t, "EMAIL")).toBe("origin.EMAIL");
    expect(originLabel(t, "WECOM")).toBe("origin.WECOM");
  });
});

describe("credentialHint（凭据标识槽位）", () => {
  it("IM 建号显示渠道名而非空邮箱", () => {
    expect(credentialHint(t, { origin: "WECOM", email: null })).toBe("origin.WECOM");
    expect(credentialHint(t, { origin: "WECOM", email: "a@b.c" })).toBe("origin.WECOM");
  });
  it("邮箱建号保留登录键；无渠道无邮箱返回 null", () => {
    expect(credentialHint(t, { origin: "EMAIL", email: "admin@x.co" })).toBe("admin@x.co");
    expect(credentialHint(t, { origin: "EMAIL", email: null })).toBeNull();
    expect(credentialHint(t, { origin: null })).toBeNull();
  });
});

describe("hasPasswordChannel（复合凭据判定）", () => {
  it("email 与 passwordHash 缺一即无密码通道", () => {
    expect(hasPasswordChannel({ email: "a@b.c", passwordHash: "h" })).toBe(true);
    expect(hasPasswordChannel({ email: "a@b.c", passwordHash: null })).toBe(false);
    expect(hasPasswordChannel({ email: null, passwordHash: "h" })).toBe(false);
    expect(hasPasswordChannel({ email: null, passwordHash: null })).toBe(false);
  });
});

describe("passwordDisableHint", () => {
  it("IM 渠道账号提示 viaChannel（渠道名作 params 注入）", () => {
    expect(passwordDisableHint(t, { origin: "WECOM" })).toBe(
      `passwordHint.viaChannel|{"channel":"origin.WECOM"}`,
    );
  });
  it("邮箱渠道无密码时提示 noPassword", () => {
    expect(passwordDisableHint(t, { origin: "EMAIL" })).toBe("passwordHint.noPassword");
    expect(passwordDisableHint(t, { origin: null })).toBe("passwordHint.noPassword");
  });
});
