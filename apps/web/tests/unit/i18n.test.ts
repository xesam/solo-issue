import { describe, expect, it } from "vitest";
import { translatorFor } from "@/i18n/translate";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";

// 服务端翻译链（translatorFor）：API 错误出口与 worker 推送共用的单源。
// 此前唯一引用 @/i18n/server 的测试是 api-server.test 的透传替身——
// 真实回退链与插值从未被直接锚定过（插值或回退退化无测试变红）。

// messages JSON 含三层嵌套（labels.origin.*），字面量类型与宽 Record 直转不兼容，经 unknown 中转
const enErrors = (en as unknown as Record<string, Record<string, string>>).errors;
const zhErrors = (zh as unknown as Record<string, Record<string, string>>).errors;

describe("translatorFor（locale 命中与回退链）", () => {
  it("zh 命中出 zh 文案，en 命中出 en 文案（点路径 lookup）", () => {
    expect(translatorFor("zh")("errors.scopeFieldUsers")).toBe(zhErrors.scopeFieldUsers);
    expect(translatorFor("en")("errors.scopeFieldUsers")).toBe(enErrors.scopeFieldUsers);
  });

  it("键不存在时回退为 key 本身（漏翻译肉眼可见）", () => {
    expect(translatorFor("zh")("errors.__no_such_key__")).toBe("errors.__no_such_key__");
    expect(translatorFor("en")("errors.__no_such_key__")).toBe("errors.__no_such_key__");
    // 中途断链（如 "errors" 下不是对象）同样兜到 key，不抛异常
    expect(translatorFor("zh")("errors.scopeFieldUsers.__deeper__")).toBe(
      "errors.scopeFieldUsers.__deeper__",
    );
  });
  // 注：zh 未命中回退 en 的中间一跳需要「en 有而 zh 无」的真实缺口才能锚定，
  // 缺口随翻译补齐会漂移，此处不构造——该跳的机制由上方两条共同覆盖 lookup 路径
});

describe("interpolate（{param} 插值）", () => {
  it("参数替换、缺失参数保留占位符（与 next-intl ICU 基础语法互通）", () => {
    const t = translatorFor("zh");
    expect(t("errors.scopeFieldUsers", { field: "区域" })).toBe("「区域」所选成员");
    expect(t("errors.selectedNotActiveMembers", { count: 2, what: "指派人" })).toBe(
      "2 位指派人不是该工作区的启用成员",
    );
    // 未传 params 时占位符原样保留（调用方缺参可见，不静默吞）
    expect(t("errors.scopeFieldUsers")).toBe(zhErrors.scopeFieldUsers);
    expect(t("errors.scopeFieldUsers", { other: "x" })).toBe(zhErrors.scopeFieldUsers);
  });
});
