import { describe, expect, it } from "vitest";
import { firstValidLine, issueSummary } from "@/lib/issue-summary";

// 摘要派生单源：列表/看板/搜索/通知的「短行」全部走这两个函数，
// 此处锁行为——空白行跳过、超长截断、空描述兜底，都是消费面依赖的语义。

describe("firstValidLine", () => {
  it("空输入返回空串", () => {
    expect(firstValidLine(undefined)).toBe("");
    expect(firstValidLine(null)).toBe("");
    expect(firstValidLine("")).toBe("");
  });

  it("取首个非空行（跳过前导空白行，trim 首行）", () => {
    expect(firstValidLine("首行")).toBe("首行");
    expect(firstValidLine("\n\n  \n第二行才是内容\n尾部")).toBe("第二行才是内容");
    expect(firstValidLine("  带缩进的首行  \n次行")).toBe("带缩进的首行");
  });

  it("全空白文本返回空串", () => {
    expect(firstValidLine(" \n\t\n  ")).toBe("");
  });
});

describe("issueSummary", () => {
  it("首行即摘要，不超长原样返回", () => {
    expect(issueSummary("短摘要\n细节")).toBe("短摘要");
  });

  it("超 max 截断加省略号；截断前先 trim 行内空白", () => {
    expect(issueSummary("x".repeat(130), 120)).toBe("x".repeat(120) + "…");
    // 判别性输入：trim 后恰好 120 不超限 → 原样返回、无省略号；
    // 实现若退化成不 trim（123 超限）则截 120 加省略号——两种实现在此分叉。
    // （121+空格这类夹具对 trim 无验证力：两种实现的输出逐字节相同）
    expect(issueSummary(`${"x".repeat(120)}   `, 120)).toBe("x".repeat(120));
  });

  it("max 边界：恰好等长不加省略号", () => {
    expect(issueSummary("x".repeat(120), 120)).toBe("x".repeat(120));
  });

  it("空描述兜底为空串（占位文案由消费面 i18n 负责）", () => {
    expect(issueSummary(null)).toBe("");
    expect(issueSummary("\n \n")).toBe("");
  });
});
