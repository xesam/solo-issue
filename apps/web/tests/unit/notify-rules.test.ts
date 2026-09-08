import { describe, expect, it } from "vitest";
import { NOTIFY_FIELD_USERS, NOTIFY_PROJECT_LEAD, notifyRuleFor } from "@/server/custom-fields/notify-rules";

const rule = { values: ["critical"], notify: [NOTIFY_PROJECT_LEAD, NOTIFY_FIELD_USERS] };

describe("notifyRuleFor（DSL 惰性求值：不合法即静默忽略）", () => {
  it("字段缺省返回 null", () => {
    expect(notifyRuleFor(undefined, "critical")).toBeNull();
  });

  it("类型只支持 TEXT/SELECT/USER（DSL 承诺面）", () => {
    expect(notifyRuleFor({ type: "NUMBER", settings: { notifyOn: rule } }, 1)).toBeNull();
    expect(notifyRuleFor({ type: "DATE", settings: { notifyOn: rule } }, "2026-01-01")).toBeNull();
    expect(
      notifyRuleFor({ type: "SELECT", settings: { notifyOn: rule } }, "critical"),
    ).toEqual(rule);
    expect(
      notifyRuleFor({ type: "TEXT", settings: { notifyOn: rule } }, "critical"),
    ).toEqual(rule);
    // USER 的正锚：值命中即触发（负例仅证明"值不命中"，不能证明 USER 在支持面内）
    expect(
      notifyRuleFor({ type: "USER", settings: { notifyOn: { values: ["u1"], notify: [NOTIFY_PROJECT_LEAD] } } }, "u1"),
    ).toEqual({ values: ["u1"], notify: [NOTIFY_PROJECT_LEAD] });
    expect(notifyRuleFor({ type: "USER", settings: { notifyOn: rule } }, "u1")).toBeNull(); // 值不命中
  });

  it("settings 缺失/空/结构不合法一律 null", () => {
    expect(notifyRuleFor({ type: "TEXT" }, "critical")).toBeNull();
    expect(notifyRuleFor({ type: "TEXT", settings: {} }, "critical")).toBeNull();
    expect(notifyRuleFor({ type: "TEXT", settings: { notifyOn: {} } }, "critical")).toBeNull();
    expect(
      notifyRuleFor(
        { type: "TEXT", settings: { notifyOn: { values: [], notify: [NOTIFY_PROJECT_LEAD] } } },
        "critical",
      ),
    ).toBeNull();
    expect(
      notifyRuleFor(
        { type: "TEXT", settings: { notifyOn: { values: ["critical"], notify: [] } } },
        "critical",
      ),
    ).toBeNull();
  });

  it("未知 notify 成员整体作废（防 DB 直改 TYPO 静默归零）", () => {
    expect(
      notifyRuleFor(
        { type: "TEXT", settings: { notifyOn: { values: ["critical"], notify: ["TYPO"] } } },
        "critical",
      ),
    ).toBeNull();
  });

  it("values 内有非字符串成员整体作废（区分性夹具：本可命中的字符串成员也不生效）", () => {
    expect(
      notifyRuleFor(
        { type: "TEXT", settings: { notifyOn: { values: [1], notify: [NOTIFY_PROJECT_LEAD] } } },
        "critical",
      ),
    ).toBeNull();
    // 若语义退化为「忽略非字符串成员」，这条会返回 rule 而非 null——两分支在此可区分
    expect(
      notifyRuleFor(
        { type: "TEXT", settings: { notifyOn: { values: [1, "critical"], notify: [NOTIFY_PROJECT_LEAD] } } },
        "critical",
      ),
    ).toBeNull();
  });

  it("值命中返回规则，未命中返回 null", () => {
    expect(
      notifyRuleFor({ type: "TEXT", settings: { notifyOn: rule } }, "critical"),
    ).toEqual(rule);
    expect(
      notifyRuleFor({ type: "TEXT", settings: { notifyOn: rule } }, "low"),
    ).toBeNull();
  });

  it("多选数组含任一命中即生效", () => {
    expect(
      notifyRuleFor({ type: "SELECT", settings: { notifyOn: rule } }, ["low", "critical"]),
    ).toEqual(rule);
    expect(
      notifyRuleFor({ type: "SELECT", settings: { notifyOn: rule } }, ["low", "mid"]),
    ).toBeNull();
    expect(notifyRuleFor({ type: "SELECT", settings: { notifyOn: rule } }, 42)).toBeNull();
  });
});
