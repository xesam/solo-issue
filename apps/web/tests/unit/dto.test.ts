import { describe, expect, it } from "vitest";
import { ISSUE_PAGE_SIZE, BOARD_PAGE_SIZE, IssueFilters, issueFilterParams } from "@/lib/dto";
import { parseIssueQuery } from "@/lib/validations";

// 客户端序列化（issueFilterParams）↔ 服务端解析（parseIssueQuery）互为逆操作：
// 保存视图把 filters 序列化进 URL，任何一端漂移都会让「保存的视图」失真。
describe("issueFilterParams 序列化", () => {
  it("只序列化显式设置的字段", () => {
    expect(issueFilterParams({})).toEqual({});
  });

  it("全量序列化含 archived 布尔转字符串", () => {
    const f: IssueFilters = {
      stateId: "s1",
      assigneeId: "u1",
      q: "kw",
      archived: false,
      orderBy: "updatedAt",
      orderDir: "desc",
    };
    expect(issueFilterParams(f)).toEqual({
      stateId: "s1",
      assigneeId: "u1",
      q: "kw",
      archived: "false",
      orderBy: "updatedAt",
      orderDir: "desc",
    });
  });

  it("自定义字段加 cf. 前缀，空值跳过", () => {
    expect(issueFilterParams({ fieldValues: { severity: "s1", empty: "" } })).toEqual({
      "cf.severity": "s1",
    });
  });
});

describe("序列化 → 解析 roundtrip", () => {
  const f: IssueFilters = {
    stateId: "s1",
    q: "kw",
    archived: true,
    assigneeId: "user-42",
    fieldValues: { severity: "s2" },
    orderBy: "createdAt",
    orderDir: "asc",
  };

  it("filters 经 URL 往返不变形", () => {
    const sp = new URLSearchParams(issueFilterParams(f));
    const parsed = parseIssueQuery(sp);
    expect(parsed.filters).toEqual(f);
  });

  it("视图模式页大小钉（分页不进 filters 快照——类型层已排除，传输层大小由视图模式定）", () => {
    expect(ISSUE_PAGE_SIZE).toBe(50);
    expect(BOARD_PAGE_SIZE).toBe(500);
  });
});
