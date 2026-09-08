#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { CLIENT_VERSION, runSelfCheck } from "./contract.js";
import { ApiClient } from "./http.js";
import { registerTools } from "./tools/index.js";

// stdio 入口：配置校验 → 启动自检（/api/meta 软闸）→ 注册工具 → 挂上 stdio。
// stdout 是 JSON-RPC 通道——一切诊断（包括本文件的 fail-fast）只走 stderr

export async function main(): Promise<void> {
  const config = loadConfig();
  const api = new ApiClient(config);
  await runSelfCheck(() => api.get("/api/meta"));

  const server = new McpServer({ name: "solo-issue-mcp", version: CLIENT_VERSION });
  registerTools(server, api);

  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
