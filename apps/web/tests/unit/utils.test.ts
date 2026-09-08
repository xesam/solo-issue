import { describe, expect, it } from "vitest";
import { cn, jsonEqual } from "@/lib/utils";

describe("cn（className 合并）", () => {
  it("后者覆盖前者冲突项", () => {
    expect(cn("p-1 p-2")).toBe("p-2");
    expect(cn("p-1", "p-2")).toBe("p-2");
  });

  it("空值跳过，非冲突项保留", () => {
    expect(cn("p-1", undefined, null, false && "x", "text-sm")).toBe("p-1 text-sm");
  });
});

describe("jsonEqual（键序无关的深度相等）", () => {
  it("标量与引用相等（同引用对象走 === 短路）", () => {
    expect(jsonEqual(1, 1)).toBe(true);
    expect(jsonEqual("a", "a")).toBe(true);
    expect(jsonEqual(null, null)).toBe(true);
    const shared = { a: [1, { b: 2 }] };
    expect(jsonEqual(shared, shared)).toBe(true); // 同引用走 === 短路（纯性能面，不另设深度断言）
    // NaN !== NaN，深比较也判不等（与 === 语义一致，见实现首行）
    expect(jsonEqual(NaN, NaN)).toBe(false);
  });

  it("类型不同即不等（数组/对象互斥双向对称）", () => {
    expect(jsonEqual(1, "1")).toBe(false);
    expect(jsonEqual(null, undefined)).toBe(false);
    expect(jsonEqual(0, null)).toBe(false);
    expect(jsonEqual([], {})).toBe(false); // typeof 同为 object，数组与对象互斥
    expect(jsonEqual({}, [])).toBe(false); // 反向：对象分支须显式排除数组
    expect(jsonEqual({ 0: "x" }, ["x"])).toBe(false); // 索引键对象伪装成数组
    expect(jsonEqual(["x"], { 0: "x" })).toBe(false); // 反向
  });

  it("对象键序无关", () => {
    expect(jsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("键集不同即不等", () => {
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("数组保持顺序且逐位比较", () => {
    expect(jsonEqual([1, 2], [1, 2])).toBe(true);
    expect(jsonEqual([2, 1], [1, 2])).toBe(false);
    expect(jsonEqual([{ x: { a: 1 } }], [{ x: { a: 1 } }])).toBe(true);
  });

  it("嵌套对象逐键递归", () => {
    expect(
      jsonEqual(
        { meta: { tags: ["a", "b"], n: 1 } },
        { meta: { n: 1, tags: ["a", "b"] } },
      ),
    ).toBe(true);
    expect(jsonEqual({ meta: { n: 1 } }, { meta: { n: 2 } })).toBe(false);
  });

  it("undefined 参与对象比较", () => {
    expect(jsonEqual({ a: undefined }, { b: undefined })).toBe(false);
  });
});
