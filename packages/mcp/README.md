# solo-issue-mcp

[solo-issue](https://github.com/xesam/solo-issue) 的 MCP 服务器：把部署实例的 REST API 包成 MCP 工具，配好地址与令牌即用——无业务逻辑、无缓存，校验与权限单源在服务端。设计文档见主仓库 [docs/11-mcp-adapter.md](../../docs/11-mcp-adapter.md)。

## 1. 前置

| 项 | 要求 |
|---|---|
| Node | ≥ 20（`npx` 自带） |
| solo-issue | 任一部署实例（本地 `http://localhost:8081/solo-issue` 或服务器地址） |
| API 令牌 | 部署实例「侧边栏 → 设置 → API 令牌」由人类签发 |

## 2. 令牌获取

1. 登录部署实例 → 「设置 → API 令牌」→「创建令牌」
2. 名称随意；**scope 只勾需要的**（见 §3 推荐）；有效期建议 30/90 天
3. 明文令牌**仅创建时可见一次**，复制保存后填入配置
4. 令牌丢失/泄露＝撤销重建，不存在找回；服务端只存哈希

权限口径：**令牌 scope ∩ 所属用户角色**——GUEST 账号的令牌永远只读。建议为 Agent 建专用用户（如「巡检机器人」）再签发令牌，活动时间线的归因才可读。

## 3. 快速接入

### 3.1 通用片段

```json
{
  "mcpServers": {
    "solo-issue": {
      "command": "npx",
      "args": ["-y", "solo-issue-mcp@latest"],
      "env": {
        "SOLO_ISSUE_URL": "https://issues.example.com/solo-issue",
        "SOLO_ISSUE_TOKEN": "itr_xxx"
      }
    }
  }
}
```

- `SOLO_ISSUE_URL`：部署服务根，**须含 basePath**（自部署默认挂 `/solo-issue` 前缀，如 `https://issues.example.com/solo-issue`；部署方经 `BASE_PATH` 改前缀时随之一致）
- `SOLO_ISSUE_TOKEN`：上一节签发的 `itr_*` 令牌
- 任一缺失或失效时，包会在启动时直接失败并给出对应指引（不会带病运行）

### 3.2 各客户端配置位置

| 客户端 | 配置文件 |
|---|---|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json`（Windows：`%APPDATA%\Claude\claude_desktop_config.json`） |
| Claude Code | 项目根 `.mcp.json`，或 `claude mcp add solo-issue -- npx -y solo-issue-mcp@latest` |
| Cursor | `~/.cursor/mcp.json`（结构同上） |

### 3.3 Windows 变体

Windows 上 `npx` 需经 `cmd` 启动：

```json
{
  "mcpServers": {
    "solo-issue": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "solo-issue-mcp@latest"],
      "env": { "SOLO_ISSUE_URL": "https://issues.example.com/solo-issue", "SOLO_ISSUE_TOKEN": "itr_xxx" }
    }
  }
}
```

### 3.4 多部署多实例

一个部署一份令牌；对接多个部署 = 配多个命名实例（工具按实例名命名空间隔离，如 `mcp__solo-work__create_issue`）：

```json
{
  "mcpServers": {
    "solo-work": {
      "command": "npx", "args": ["-y", "solo-issue-mcp@latest"],
      "env": { "SOLO_ISSUE_URL": "https://issues.corp.com/solo-issue", "SOLO_ISSUE_TOKEN": "itr_aaa" }
    },
    "solo-personal": {
      "command": "npx", "args": ["-y", "solo-issue-mcp@latest"],
      "env": { "SOLO_ISSUE_URL": "http://localhost:8081/solo-issue", "SOLO_ISSUE_TOKEN": "itr_bbb" }
    }
  }
}
```

- 实例名要可区分（`solo-work`，不要 `solo-issue-2`）
- 优先项目级配置圈定作用域：公司仓库的 `.mcp.json` 只注册工作部署
- 不常用的实例按需启停，控制工具面上下文成本
- 同一部署配多身份（人/机器人各一令牌）也是同款形态

### 3.5 安全纪律

- **令牌不要进 git**：项目级 `.mcp.json` 会随仓库分发——需要提交的项目用留空模板，令牌走本地未跟踪文件或环境变量：

```json
{
  "mcpServers": {
    "solo-issue": {
      "command": "npx",
      "args": ["-y", "solo-issue-mcp@latest"],
      "env": { "SOLO_ISSUE_URL": "https://issues.example.com/solo-issue", "SOLO_ISSUE_TOKEN": "" }
    }
  }
}
```

- 最小 scope；巡检只读通常 `issues:read + search:read + projects:read` 就够；禁用 `*`
- 限期令牌（30/90 天），轮换而非永生

| 用途 | 推荐 scope |
|---|---|
| 巡检/只读 | `projects:read` `fields:read` `issues:read` `comments:read` `search:read` |
| 可写操作 | 巡检集 + `issues:write` `comments:write` |
| 字段定义维护 | 可写集 + `fields:write`（需项目负责人角色） |

## 4. 工具清单

| 工具 | 说明 |
|---|---|
| `list_projects` | 工作区项目列表（其余工具 projectId 的来源） |
| `list_states` | 项目状态列表（stateId 与三档结局语义） |
| `list_members` | 成员列表（assigneeIds 的 userId 来源） |
| `get_fields_schema` | 自定义字段 JSON Schema——写 issue 的 fieldValues 前必读 |
| `search_everything` | 跨工作区搜索 issue 与项目（`q` + 自定义字段过滤，结果带深链；项目名命中给项目页链接） |
| `list_issues` | 项目内列表（状态/指派/关键词/字段过滤、分页） |
| `read_issue` | issue 详情 |
| `read_history` | 活动流（谁在何时改了什么） |
| `create_issue` | 创建（无幂等键：失败后先 search 确认再补建） |
| `update_issue` | 部分更新（只传变更字段，多次调用安全） |
| `add_comment` | 评论（Tiptap JSON，支持 @提及） |

指派/提及/状态变更/评论会自动通知相关同事——无需（也无法）经 MCP 发通知。

## 5. 排障

| 症状 | 含义与处置 |
|---|---|
| 启动即退：提醒重新签发令牌 | 401：令牌无效/过期/撤销——部署实例重新签发并更新配置 |
| 启动即退：无法连接服务 | `SOLO_ISSUE_URL` 错误或服务未起——检查地址含 basePath（默认 `/solo-issue`，随部署的 `BASE_PATH`） |
| 工具返回 `[HTTP 403]` | scope/角色不足——核对令牌 scope 与用户角色，不要重试 |
| 工具返回 `[HTTP 422]` | 参数校验失败——按字段明细修正（fieldValues 的 key/枚举先查 schema） |
| 工具返回 `[HTTP 429]` | 触发频控（120 次/分钟/令牌）——等待 `Retry-After` 秒数再调 |
| 启动或调用被要求升级（426） | 本包版本低于服务端下限——`npx -y solo-issue-mcp@latest` 升级 |
| `[HTTP 404]` | 对象不存在或无权可见 |

## 6. 版本协商

启动时本包会请求部署实例的 `/api/meta`：令牌有效性、网络可达性、REST 契约版本三者任一不符都**在第一次会话前失败**并给出指引。服务端也会拒绝过旧的包版本（426）——`npx ...@latest` 即自愈。契约版本的定级与支持窗口见主仓库 `docs/11-mcp-adapter.md` §5。
