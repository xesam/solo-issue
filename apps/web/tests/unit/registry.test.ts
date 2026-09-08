import { describe, expect, it } from "vitest";
import type { CustomField, FieldType } from "@prisma/client";
import { HttpError } from "@/lib/api";
import {
  activeSelectOptions,
  fieldText,
  selectOrUserMultiple,
  userFieldIdentifiers,
  userIdsOfFieldValue,
  validateFieldValues,
} from "@/server/custom-fields/registry";

/** 构造形状完整的 CustomField（registry 只读 key/type/options/settings/isRequired） */
function mkField(over: Partial<CustomField> & { key: string; type: FieldType }): CustomField {
  return {
    id: `id_${over.key}`,
    projectId: "p1",
    name: over.name ?? over.key,
    options: null,
    settings: null,
    isRequired: false,
    isArchived: false,
    sequence: 0,
    version: 1,
    createdById: "u0",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as CustomField;
}

const expect422 = (fn: () => unknown) => {
  try {
    fn();
    expect.unreachable("应当抛出 422");
  } catch (e) {
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(422);
  }
};

describe("TEXT 类型", () => {
  const f = mkField({ key: "t", type: "TEXT" });
  it("trim 后入账", () => {
    expect(validateFieldValues([f], { t: " hello " }, { enforceRequired: false }).t).toBe("hello");
  });
  it("非字符串/trim 后为空/超长一律 422", () => {
    expect422(() => validateFieldValues([f], { t: 123 }, { enforceRequired: false }));
    expect422(() => validateFieldValues([f], { t: "   " }, { enforceRequired: false }));
    expect422(() => validateFieldValues([f], { t: "x".repeat(2001) }, { enforceRequired: false }));
  });
});

describe("NUMBER 类型", () => {
  const f = mkField({ key: "n", type: "NUMBER" });
  it("数字照常；数字字符串归一为 number", () => {
    const v = validateFieldValues([f], { n: "12" }, { enforceRequired: false });
    expect(v.n).toBe(12);
    expect(validateFieldValues([f], { n: 3.5 }, { enforceRequired: false }).n).toBe(3.5);
  });
  it("不可数值化/非有限数 422（空串走清空哨兵语义，见通用语义节）", () => {
    expect422(() => validateFieldValues([f], { n: "abc" }, { enforceRequired: false }));
    expect422(() => validateFieldValues([f], { n: "1e999" }, { enforceRequired: false })); // Infinity
    expect422(() => validateFieldValues([f], { n: true }, { enforceRequired: false }));
  });
});

describe("DATE 类型", () => {
  const f = mkField({ key: "d", type: "DATE" });
  it("合法 YYYY-MM-DD 原样保留（含真实闰日）", () => {
    expect(validateFieldValues([f], { d: "2026-01-31" }, { enforceRequired: false }).d).toBe("2026-01-31");
    expect(validateFieldValues([f], { d: "2024-02-29" }, { enforceRequired: false }).d).toBe("2024-02-29");
  });
  it("形态非法一律 422（注意：空串 == 清空哨兵，归通用语义）", () => {
    expect422(() => validateFieldValues([f], { d: "2026/01/31" }, { enforceRequired: false }));
    expect422(() => validateFieldValues([f], { d: "2026-1-1" }, { enforceRequired: false }));
    expect422(() => validateFieldValues([f], { d: "2026-13-01" }, { enforceRequired: false })); // 语义非法月份
    expect422(() => validateFieldValues([f], { d: 2026 }, { enforceRequired: false }));
    // 日历回读闸：Date.parse 对日溢出进位（2024-02-30 → 3 月 1 日），回读比对才拦得住
    expect422(() => validateFieldValues([f], { d: "2024-02-30" }, { enforceRequired: false }));
    expect422(() => validateFieldValues([f], { d: "2023-02-29" }, { enforceRequired: false })); // 平年 2 月 29
  });
});

describe("SELECT 类型", () => {
  const options = [
    { value: "s1", label: "S1" },
    { value: "s2", label: "S2", archived: true }, // 已软删
    { value: "s3", label: "S3" },
  ];
  const f = mkField({ key: "sel", type: "SELECT", options });
  const fm = mkField({ key: "selm", type: "SELECT", options, settings: { multiple: true } });

  it("单选：活动选项合法；未列值 422；软删选项新写入 422", () => {
    expect(validateFieldValues([f], { sel: "s1" }, { enforceRequired: false }).sel).toBe("s1");
    expect422(() => validateFieldValues([f], { sel: "nope" }, { enforceRequired: false }));
    expect422(() => validateFieldValues([f], { sel: "s2" }, { enforceRequired: false }));
  });

  it("软删存量值与原值相同可保存（历史值不被软删卡死），换新软删值仍拒", () => {
    const kept = validateFieldValues([f], { sel: "s2" }, {
      enforceRequired: false,
      prevValues: { sel: "s2" },
    });
    expect(kept.sel).toBe("s2");
    // prev 是 s1，提交 s2（软删但非原值）→ 422
    expect422(() =>
      validateFieldValues([f], { sel: "s2" }, { enforceRequired: false, prevValues: { sel: "s1" } }),
    );
  });

  it("多选：数组、去重保序、空数组/标量 422", () => {
    const v = validateFieldValues([fm], { selm: ["s3", "s1", "s3"] }, { enforceRequired: false });
    expect(v.selm).toEqual(["s3", "s1"]);
    expect422(() => validateFieldValues([fm], { selm: [] }, { enforceRequired: false }));
    expect422(() => validateFieldValues([fm], { selm: "s1" }, { enforceRequired: false }));
    expect422(() => validateFieldValues([fm], { selm: ["s1", "x"] }, { enforceRequired: false }));
  });

  it("多选软删存量项经 prevValues 放行，混入未知项整体 422", () => {
    const kept = validateFieldValues([fm], { selm: ["s1", "s2"] }, {
      enforceRequired: false,
      prevValues: { selm: ["s2"] },
    });
    expect(kept.selm).toEqual(["s1", "s2"]);
    expect422(() =>
      validateFieldValues([fm], { selm: ["s2", "s9"] }, { enforceRequired: false, prevValues: { selm: ["s2"] } }),
    );
  });

  it("text() 渲染：单选取 label，多选 label 以「、」连接", () => {
    expect(fieldText(f, "s1")).toBe("S1");
    expect(fieldText(fm, ["s1", "s3"])).toBe("S1、S3");
    expect(fieldText(f, "unknown")).toBe("unknown"); // 历史幽灵值回显不炸
    expect(fieldText(f, null)).toBe("");
  });

  it("activeSelectOptions 只列未软删项", () => {
    expect(activeSelectOptions(f).map((o) => o.value)).toEqual(["s1", "s3"]);
  });

  it("软删存量值放行不豁免形状闸：单选收数组/多选收标量仍 422（即使 prevValues 命中）", () => {
    // 场景：字段选项曾软删且库里存量值与 prev 相同——唯一允许绕过「新写入不可选软删值」
    // 的通道。此通道不得同时绕过形状校验（否则单选可存 string[]，检索永远失配）
    const single = mkField({
      key: "sev",
      type: "SELECT",
      options: [
        { value: "s1", label: "在售" },
        { value: "gone", label: "已软删", archived: true },
      ],
    });
    expect422(() =>
      validateFieldValues(
        [single],
        { sev: ["gone"] },
        { enforceRequired: false, prevValues: { sev: "gone" } },
      ),
    );
    expect422(() =>
      validateFieldValues(
        [single],
        { sev: ["s1"] },
        { enforceRequired: false, prevValues: { sev: "s1" } },
      ),
    );
    const multi = mkField({
      key: "multi",
      type: "SELECT",
      settings: { multiple: true },
      options: [
        { value: "m1", label: "在" },
        { value: "gone2", label: "软删", archived: true },
      ],
    });
    expect422(() =>
      validateFieldValues(
        [multi],
        { multi: "gone2" },
        { enforceRequired: false, prevValues: { multi: ["gone2"] } },
      ),
    );
    // 形状相符的软删存量放行仍可用（正向锚：收紧不能误伤合法存量保存）
    expect(
      validateFieldValues(
        [single],
        { sev: "gone" },
        { enforceRequired: false, prevValues: { sev: "gone" } },
      ),
    ).toEqual({ sev: "gone" });
    expect(
      validateFieldValues(
        [multi],
        { multi: ["gone2"] },
        { enforceRequired: false, prevValues: { multi: ["gone2"] } },
      ),
    ).toEqual({ multi: ["gone2"] });
  });
});

describe("USER 类型", () => {
  const f = mkField({ key: "u", type: "USER" });
  const fm = mkField({ key: "um", type: "USER", settings: { multiple: true } });

  it("单选字符串 userId；多选数组去重保序", () => {
    expect(validateFieldValues([f], { u: "user1" }, { enforceRequired: false }).u).toBe("user1");
    const v = validateFieldValues([fm], { um: ["b", "a", "b"] }, { enforceRequired: false });
    expect(v.um).toEqual(["b", "a"]);
  });

  it("非法形态 422（空串 == 清空哨兵归通用语义）", () => {
    expect422(() => validateFieldValues([f], { u: "  " }, { enforceRequired: false }));
    expect422(() => validateFieldValues([f], { u: 123 }, { enforceRequired: false }));
    expect422(() => validateFieldValues([fm], { um: [] }, { enforceRequired: false }));
    expect422(() => validateFieldValues([fm], { um: "x" }, { enforceRequired: false }));
    expect422(() => validateFieldValues([fm], { um: ["a", 1] }, { enforceRequired: false }));
  });

  it("text() 渲染 userId 串", () => {
    expect(fieldText(f, "u1")).toBe("u1");
    expect(fieldText(fm, ["u1", "u2"])).toBe("u1, u2");
  });
});

describe("validateFieldValues 通用语义", () => {
  const opt = mkField({ key: "opt", type: "TEXT" });
  const req = mkField({ key: "req", type: "TEXT", isRequired: true });

  it("enforceRequired：创建路径缺必填 422；更新路径豁免（存量追溯不拦截）", () => {
    expect422(() => validateFieldValues([req], {}, { enforceRequired: true }));
    expect(validateFieldValues([req], {}, { enforceRequired: false })).toEqual({});
  });

  it("显式 null / 空串 = 清空：必填不可清空，选填置 null", () => {
    expect422(() => validateFieldValues([req], { req: null }, { enforceRequired: false }));
    expect422(() => validateFieldValues([req], { req: "" }, { enforceRequired: false }));
    expect(validateFieldValues([opt], { opt: null }, { enforceRequired: false }).opt).toBeNull();
    expect(validateFieldValues([opt], { opt: "" }, { enforceRequired: false }).opt).toBeNull();
  });

  it("未知 key 一律 422（防定义漂移期幽灵数据）", () => {
    expect422(() => validateFieldValues([opt], { ghost: 1 }, { enforceRequired: false }));
  });

  it("未提交的 key 不出现在输出（合并语义由服务层负责）", () => {
    const v = validateFieldValues([opt, req], { opt: "x" }, { enforceRequired: false });
    expect(v).toEqual({ opt: "x" });
  });
});

describe("辅助函数", () => {
  const options = [
    { value: "a", label: "甲" },
    { value: "b", label: "乙", archived: true },
  ];
  it("selectOrUserMultiple 识别 settings.multiple", () => {
    expect(selectOrUserMultiple(mkField({ key: "x", type: "SELECT" }))).toBe(false);
    expect(selectOrUserMultiple(mkField({ key: "x", type: "SELECT", settings: { multiple: true } }))).toBe(true);
    expect(selectOrUserMultiple(mkField({ key: "x", type: "SELECT", settings: {} }))).toBe(false);
  });

  it("userIdsOfFieldValue 兼容单选/多选/空值提取", () => {
    expect(userIdsOfFieldValue("u1")).toEqual(["u1"]);
    expect(userIdsOfFieldValue("")).toEqual([]);
    expect(userIdsOfFieldValue(["u1", "u2", "", 1])).toEqual(["u1", "u2"]);
    expect(userIdsOfFieldValue(null)).toEqual([]);
    expect(userIdsOfFieldValue(42)).toEqual([]);
  });

  it("userFieldIdentifiers 聚合一次写入中的 USER 字段", () => {
    const uf = mkField({ key: "owner", type: "USER" });
    const sf = mkField({ key: "sev", type: "SELECT", options });
    const out = userFieldIdentifiers([uf, sf], { owner: ["u1", "u2"], sev: "a" });
    expect(out).toEqual([{ field: uf, userIds: ["u1", "u2"] }]);
  });
});
