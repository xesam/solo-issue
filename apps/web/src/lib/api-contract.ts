// MCP 契约版本单源（docs/11-mcp-adapter.md §5）：/api/meta 的响应数据与
// X-Client 426 版本闸共用此处的常量；packages/mcp 的 SUPPORTED_CONTRACTS
// 需与本文件保持同步——契约升位按 docs/11-mcp-adapter.md §5.1 定级表走。

export const API_CONTRACT_VERSION = 1 as const;
export const MIN_MCP_VERSION = "0.0.1" as const;

// X-Client 约定形态：solo-issue-mcp/<主.次.修订>。非该前缀/非三段数字一律视作
// 外来客户端（fail-open）：版本闸只治理自家分发的 mcp 包，脚本与自建 Agent 不受影响
const MCP_CLIENT_PREFIX = "solo-issue-mcp/";

type Semver = [number, number, number];

export function parseMcpVersion(header: string | null): Semver | null {
  if (!header?.startsWith(MCP_CLIENT_PREFIX)) return null;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(header.slice(MCP_CLIENT_PREFIX.length).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isVersionBelow(a: Semver, b: Semver): boolean {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
}

const MIN_SEMVER = parseMcpVersion(MCP_CLIENT_PREFIX + MIN_MCP_VERSION);
if (!MIN_SEMVER)
  throw new Error("MIN_MCP_VERSION 必须是“主.次.修订”三段数字——模块加载即失败，防带病上线");
// 收窄结果另存常量：控制流收窄不跨函数边界，mcpClientOutdated 的函数体里
// MIN_SEMVER 仍是可空类型——以 MIN 为不可空别名使用
const MIN: Semver = MIN_SEMVER;

/** 请求的 X-Client 是否低于服务端放行下限（token.ts 据此返回 426） */
export function mcpClientOutdated(header: string | null): boolean {
  const v = parseMcpVersion(header);
  return v !== null && isVersionBelow(v, MIN);
}

/** /api/meta 响应负载（version 为部署应用版本，由路由侧从 package.json 注入） */
export function mcpMetaPayload(version: string) {
  return {
    version,
    apiContractVersion: API_CONTRACT_VERSION,
    minMcpVersion: MIN_MCP_VERSION,
  };
}
