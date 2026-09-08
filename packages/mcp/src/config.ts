// 环境变量读取与 fail-fast：所有错误必须给出「缺什么 + 去哪拿」的可操作指引。
// stdio 形态下错误一律走 stderr（stdout 是 JSON-RPC 通道，禁止污染）

export class ConfigError extends Error {}

export type McpConfig = { baseUrl: string; token: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const url = env.SOLO_ISSUE_URL?.trim();
  const token = env.SOLO_ISSUE_TOKEN?.trim();
  if (!url)
    throw new ConfigError(
      "缺少环境变量 SOLO_ISSUE_URL：solo-issue 部署服务根（须含 basePath，如 https://issues.example.com/solo-issue 或本地 http://localhost:8081/solo-issue）",
    );
  if (!token)
    throw new ConfigError(
      "缺少环境变量 SOLO_ISSUE_TOKEN：在部署实例「侧边栏 → 设置 → API 令牌」由人类签发（itr_ 前缀，仅创建时可见）",
    );
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError(`SOLO_ISSUE_URL 不是合法 URL：${url}`);
  }
  if (!/^https?:$/.test(parsed.protocol))
    throw new ConfigError(`SOLO_ISSUE_URL 协议须为 http/https：${url}`);
  return { baseUrl: url.replace(/\/+$/, ""), token };
}
