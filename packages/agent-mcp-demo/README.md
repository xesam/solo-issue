# agent-mcp-demo

面向 Claude Code 的 solo-issue MCP 示范配置项目：把本目录当项目根打开（`cd packages/agent-mcp-demo && claude`），审批后即得 solo-issue 的全部 MCP 工具。MCP 包本体在 [packages/mcp](../mcp)（npm 包名 `solo-issue-mcp`），设计文档见 [docs/11-mcp-adapter.md](../../docs/11-mcp-adapter.md)；令牌获取、scope 推荐、通用排障单源于 [packages/mcp/README.md](../mcp/README.md)，本文只讲本目录特有的部分。目录级说明与两包间的依赖方向见 [packages/README.md](../README.md)。

## 1. 前置

| 项 | 要求 |
|---|---|
| Node | ≥ 20 |
| MCP 包 | 先构建一次：仓库根执行 `pnpm -C packages/mcp build`——`dist/index.js` 是本地构建产物，不进 git；改适配层代码后重建、`/mcp` 里重连即生效 |
| solo-issue 部署 | 任一运行中的实例；本地开发 `pnpm dev` 即 `http://localhost:8081/solo-issue`（起步见 [docs/README.md](../../docs/README.md)） |
| API 令牌 | 部署实例「侧边栏 → 设置 → API 令牌」由人类签发（`itr_` 前缀，仅创建时可见一次）；获取步骤与 scope 推荐见 [packages/mcp/README.md](../mcp/README.md) §2/§3.5 |

## 2. 配置（.mcp.json）

本目录的 [.mcp.json](./.mcp.json) 即 Claude Code 的项目级 MCP 配置，默认指向**仓库内**的 MCP 包产物（改适配层代码可直接体验，无需发版）：

```json
{
  "mcpServers": {
    "solo-issue": {
      "command": "node",
      "args": ["../mcp/dist/index.js"],
      "env": {
        "SOLO_ISSUE_URL": "http://localhost:8081/solo-issue",
        "SOLO_ISSUE_TOKEN": ""
      }
    }
  }
}
```

| 字段 | 说明 |
|---|---|
| `args` | 相对本目录解析（Claude Code 以项目根为工作目录启动服务器），指向 `packages/mcp` 的构建产物——所以 §1 要先 build |
| `SOLO_ISSUE_URL` | 部署服务根，**须含 basePath**（默认部署挂在 `/solo-issue` 前缀下；本地开发为 `http://localhost:8081/solo-issue`） |
| `SOLO_ISSUE_TOKEN` | **留空模板**——本文件要提交进 git，令牌由使用者自行填入（防泄漏纪律见 [packages/mcp/README.md](../mcp/README.md) §3.5） |

> 令牌为空时服务器启动即失败并提示「缺少环境变量 SOLO_ISSUE_TOKEN」，这是包的 fail-fast 设计（[packages/mcp/src/config.ts](../mcp/src/config.ts)）——不是故障，填好令牌再继续。

### 2.1 换成 npm 发布包 / 线上部署

本目录默认演示接仓库内包的形态。改用 npm 发布包时，取根下对应形态的示例文件，复制内容替换 [.mcp.json](./.mcp.json)（或放进你自己的项目根）即切换，`SOLO_ISSUE_URL` 换成部署地址（须含 basePath）——各客户端片段一致，Windows 变体、多部署多实例见 [packages/mcp/README.md](../mcp/README.md) §3.3/§3.4：

| 形态 | 示例文件 | 要点 |
|---|---|---|
| npx（零安装，通用首选） | [mcp.npx.json](./mcp.npx.json) | `npx -y solo-issue-mcp@latest` 按需拉取并缓存，无需 build/install；`@latest` 每次解析最新发布版，被服务端 426 拒时升级即自愈 |
| 依赖（版本锁定） | [mcp.deps.json](./mcp.deps.json) | 包钉进 [package.json](./package.json) 的 devDependency（当前 `^0.0.1`，范围随发布调整）→ install 后 `.mcp.json` 指向 `node_modules/solo-issue-mcp/dist/index.js`（亦可用 `node_modules/.bin/solo-issue-mcp`）；本目录照此两步即用，自己项目照搬同款两步。适合版本审计、内网镜像、离线安装 |

两种形态的令牌纪律与 §2 一致：示例一律留空 `SOLO_ISSUE_TOKEN`，由使用者填入。

## 3. 打开

```bash
cd packages/agent-mcp-demo
claude
```

- 首次进入会请求审批本目录的项目级 MCP 服务器，允许后用 `/mcp` 确认 `solo-issue` 状态为 connected
- 调整令牌或 URL 后，在 `/mcp` 里重连即可生效

## 4. 试一试

示例提问（工具由会话中的 Claude Code 自主编排，无需点名；工具面清单见 [packages/mcp/README.md](../mcp/README.md) §4）：

| 场景 | 可以这样问 |
|---|---|
| 发现上下文 | 「用 solo-issue 列出我的项目，再看第一个项目有哪些状态」 |
| 搜索 | 「搜出 s1 严重度且未完成的 issue」 |
| 读历史 | 「DEMO-12 谁在什么时候改了什么？总结时间线」 |
| 建 issue | 「在 DEMO 项目建个 issue：标题『……』，严重度 s1，指派给张三」 |
| 评论与提及 | 「给 DEMO-12 评论『已复现』并提醒张三」 |

- 建单前 Claude Code 会先读项目字段 schema（`get_fields_schema`），字段枚举与必填不用人工说明
- 指派、@提及、状态变更、评论会自动通知相关同事——无需（也无法）经 MCP 发通知

## 5. 排障

| 症状 | 处置 |
|---|---|
| 服务器启动即退，提示缺少 `SOLO_ISSUE_TOKEN` | §2：`.mcp.json` 里填入令牌（留空模板是预期状态，不是故障） |
| `/mcp` 里找不到 solo-issue 服务器 | 在仓库根或其他目录启动了 `claude`——本配置是项目级的，只在 `packages/agent-mcp-demo` 内生效（§3） |
| 服务器启动即退，报找不到模块/文件 | §1 的 build 没跑：新 clone 的仓库须先 `pnpm -C packages/mcp build` 产出 `dist/` |
| 换用 §2.1 依赖形态后启动即退，报找不到 `node_modules/solo-issue-mcp/...` | install 没跑：[package.json](./package.json) 已声明该 devDependency，先 install 才有可指向的产物 |
| 工具组显示为 `solo_issue`（下划线），按服务器名连字符形式搜索工具无结果 | 同一服务器的两种呈现：Claude Code 工具命名空间把服务器名以 `solo_issue` 形式暴露（`mcp__solo_issue__*`），按此形式检索即命中。先在 `/mcp` 核对连接状态，再用 `claude mcp list` 排除同部署被重复注册的情形 |

其余症状（401/403/426/429、令牌过期、地址错误）对照 [packages/mcp/README.md](../mcp/README.md) §5。
