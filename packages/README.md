# packages

monorepo 的分包目录（`pnpm-workspace.yaml` 以 `packages/*` 纳入工作区），当前两个包：

| 包 | npm 包名 | 性质 | 定位 |
|---|---|---|---|
| [mcp](./mcp) | `solo-issue-mcp` | 对外发布 | solo-issue 的 MCP 服务器：部署实例 REST API 之上的纯透传协议适配层，详细文档见 [mcp/README.md](./mcp/README.md) |
| [agent-mcp-demo](./agent-mcp-demo) | —— | `private`，仅仓库内 | Claude Code 接入 solo-issue-mcp 的示范配置项目，用法见 [agent-mcp-demo/README.md](./agent-mcp-demo/README.md) |

- agent-mcp-demo 依赖 mcp：`.mcp.json` 指向 mcp 的构建产物（`../mcp/dist/index.js`），令牌、scope、排障等指引自单源于 mcp 的 README