import { describe, expect, it } from "vitest";
import {
  API_CONTRACT_VERSION,
  MIN_MCP_VERSION,
  isVersionBelow,
  mcpClientOutdated,
  mcpMetaPayload,
  parseMcpVersion,
} from "@/lib/api-contract";

// MCP 契约版本单源的纯逻辑矩阵（docs/11-mcp-adapter.md §5）——
// 426 闸位次与 /api/meta 形状的端到端断言在 tests/integration/auth-token.test.ts

describe("parseMcpVersion", () => {
  it("识别 solo-issue-mcp/<主.次.修订>", () => {
    expect(parseMcpVersion("solo-issue-mcp/1.2.3")).toEqual([1, 2, 3]);
    expect(parseMcpVersion("solo-issue-mcp/0.0.1")).toEqual([0, 0, 1]);
  });

  it("无头/异头/非三段数字一律 null（fail-open，不治理外来客户端）", () => {
    expect(parseMcpVersion(null)).toBeNull();
    expect(parseMcpVersion("")).toBeNull();
    expect(parseMcpVersion("curl/8.4")).toBeNull();
    expect(parseMcpVersion("solo-issue-mcp")).toBeNull();
    expect(parseMcpVersion("solo-issue-mcp/1.2")).toBeNull();
    expect(parseMcpVersion("solo-issue-mcp/1.2.3-beta")).toBeNull();
    expect(parseMcpVersion("solo-issue-mcp/latest")).toBeNull();
  });
});

describe("isVersionBelow", () => {
  it("主>次>修订单调递进比较（同一停更位则看下一位）", () => {
    expect(isVersionBelow([0, 9, 9], [1, 0, 0])).toBe(true);
    expect(isVersionBelow([1, 0, 0], [1, 0, 0])).toBe(false);
    expect(isVersionBelow([1, 2, 0], [1, 10, 0])).toBe(true);
    expect(isVersionBelow([1, 0, 1], [1, 0, 0])).toBe(false);
    expect(isVersionBelow([2, 0, 0], [1, 9, 9])).toBe(false);
  });
});

describe("mcpClientOutdated（426 判定）", () => {
  it("仅拦带有效 semver 且低于 MIN_MCP_VERSION 的自家 mcp 包", () => {
    expect(mcpClientOutdated("solo-issue-mcp/0.0.0")).toBe(true);
    expect(mcpClientOutdated(`solo-issue-mcp/${MIN_MCP_VERSION}`)).toBe(false);
    expect(mcpClientOutdated("solo-issue-mcp/99.0.0")).toBe(false);
    // 无头/异头/非语义化形态：不适用版本闸（脚本与自建 Agent 零影响——AGENTS.md 明示）
    expect(mcpClientOutdated(null)).toBe(false);
    expect(mcpClientOutdated("axios/1.7.0")).toBe(false);
    expect(mcpClientOutdated("solo-issue-mcp/latest")).toBe(false);
  });
});

describe("mcpMetaPayload（/api/meta 契约形状）", () => {
  it("应用版本 + 契约版本 + mcp 下限三键与常量同源", () => {
    expect(mcpMetaPayload("3.2.1")).toEqual({
      version: "3.2.1",
      apiContractVersion: API_CONTRACT_VERSION,
      minMcpVersion: MIN_MCP_VERSION,
    });
  });
});
