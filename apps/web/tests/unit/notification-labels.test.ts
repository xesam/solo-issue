import { describe, expect, it } from "vitest";
import { typeLabel } from "@/lib/notification-labels";

// 客户端纯映射：内部枚举走 t(key)翻译，未知类型原样透传（不吞错）

const t = (key: string) => `label:${key}`;

describe("typeLabel", () => {
  it("四种通知类型经 t 翻译（内部枚举上屏前必须过映射）", () => {
    expect(typeLabel(t, "ASSIGNED")).toBe("label:ASSIGNED");
    expect(typeLabel(t, "MENTIONED")).toBe("label:MENTIONED");
    expect(typeLabel(t, "COMMENTED")).toBe("label:COMMENTED");
    expect(typeLabel(t, "STATE_CHANGED")).toBe("label:STATE_CHANGED");
  });

  it("未知/未来类型原样返回（不塌成空白）", () => {
    expect(typeLabel(t, "SOMETHING_NEW")).toBe("SOMETHING_NEW");
    expect(typeLabel(t, "")).toBe("");
  });
});
