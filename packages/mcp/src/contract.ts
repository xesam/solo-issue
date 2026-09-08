import pkg from "../package.json";
import { ApiHttpError } from "./errors.js";

// 版本协商（docs/11-mcp-adapter.md §5）：本包版本即 X-Client 头的取值，
// 服务端以 /api/meta 的 apiContractVersion + minMcpVersion 判定兼容。
// SUPPORTED_CONTRACTS 与 apps/web/src/lib/api-contract.ts 的 API_CONTRACT_VERSION 保持同步
// （monorepo 化后单包仓库根路径已不成立）。

export const CLIENT_VERSION: string = pkg.version;
const MCP_CLIENT_PREFIX = "solo-issue-mcp/";
export const X_CLIENT = `${MCP_CLIENT_PREFIX}${CLIENT_VERSION}`;
export const SUPPORTED_CONTRACTS = [1] as const;

export type MetaInfo = {
  version: string;
  apiContractVersion: number;
  minMcpVersion: string;
};

export class SelfCheckError extends Error {}

/**
 * 启动自检（软闸）：调 /api/meta——401（换签/更新令牌）、网络不可达（查 URL）、
 * 契约版本不在支持范围（升级本包）都在第一次会话截断，不留到使用中途。
 * fetchMeta 需返回已剥壳的 meta 数据；ApiHttpError / 网络异常在此分诊为人话。
 */
export async function runSelfCheck(fetchMeta: () => Promise<MetaInfo>): Promise<MetaInfo> {
  let meta: MetaInfo;
  try {
    meta = await fetchMeta();
  } catch (e) {
    if (e instanceof ApiHttpError && e.status === 401)
      throw new SelfCheckError(
        "API 令牌无效、已过期或被撤销：请在部署实例重新签发令牌并更新 SOLO_ISSUE_TOKEN",
      );
    if (e instanceof ApiHttpError && e.status === 426)
      throw new SelfCheckError(
        `本 MCP 包版本过低，服务端要求 ${e.message}——运行 npx -y solo-issue-mcp@latest 升级后重试`,
      );
    if (e instanceof ApiHttpError)
      throw new SelfCheckError(`服务端返回 HTTP ${e.status}：${e.message}`);
    throw new SelfCheckError(
      `无法连接 solo-issue 服务（${e instanceof Error ? e.message : String(e)}）：检查 SOLO_ISSUE_URL 是否指向运行中的部署、须含 basePath（如 /solo-issue）`,
    );
  }
  if (!(SUPPORTED_CONTRACTS as readonly number[]).includes(meta.apiContractVersion))
    throw new SelfCheckError(
      `服务端契约版本 v${meta.apiContractVersion} 不在本包支持范围（${SUPPORTED_CONTRACTS.join("/")}）：请升级 solo-issue-mcp（npx -y solo-issue-mcp@latest）或核对部署版本`,
    );
  return meta;
}
