# AGENTS.md

面向在本仓库工作的 AI Agent / 开发者的入口文档。改代码前先读对应文档，**docs/ 下的事实源优先于任何通用惯例**。

前半部分（文档索引、快速纪律）面向**在仓库里写代码的开发者/AI 协作者**；后半部分「Agent API 接入」是**以程序方式操作本系统**的外部 Agent 的工具说明书，可直接放入 Agent 的系统提示词。

## 文档索引

| 文档 | 内容 | 何时必读 |
|---|---|---|
| [docs/01-architecture.md](docs/01-architecture.md) | 架构与设计：目标/选型/系统架构/核心机制/通知 | 建立全局认知时 |
| [docs/02-data-model.md](docs/02-data-model.md) | 数据模型：ER 总览/模型语义与不变量/身份模型/schema 现役定义指针 | 看/改 `apps/web/prisma/schema.prisma` 时 |
| [docs/03-auth.md](docs/03-auth.md) | 认证与 IM 渠道：双通道/OAuth 流程/Provider 接口/恢复预案/mock 通道 | 改认证、接 IM 渠道时 |
| [docs/07-ui-guidelines.md](docs/07-ui-guidelines.md) | UI 组件规范：设计令牌、状态色、光标/圆角/字号/间距刻度、**§7 带侧边栏页面的布局原则（四壳同构、内容区全宽禁 max-w 居中）** | 写任何带 UI 的代码前 |
| [docs/06-api-contract.md](docs/06-api-contract.md) | API 契约：全部 `/api/*` 路由/分页排序约定/错误语义 | 改动 `/api/*` 路由前后 |
| [docs/05-custom-fields.md](docs/05-custom-fields.md) | 自定义字段体系 | 涉及项目字段/Issue 表单时 |
| [docs/10-testing.md](docs/10-testing.md) | 测试体系：分层防线/单测与集成边界/覆盖率门槛/本地一键门禁 | 写测试、改 lib/server 代码前后 |
| [docs/11-mcp-adapter.md](docs/11-mcp-adapter.md) | MCP 适配器设计：npm 包分发/工具面映射/契约版本与版本协商 | 改 MCP 适配器与契约版本定级前后 |
| [docs/04-workspace-design.md](docs/04-workspace-design.md) | 工作区/项目模型设计（含能力矩阵单一事实源） | 改动工作区、成员、权限时 |
| [docs/08-deployment.md](docs/08-deployment.md) | 部署与运维指南：Docker Compose / 直接在服务器上运行 / 环境变量全表 / 安全基线 / 备份升级排障 | 部署/运维时 |
| [docs/09-wecom-setup.md](docs/09-wecom-setup.md) | 企微正式接入：凭证/应用配置/免登与扫码冒烟 | 接企微时 |
| [docs/README.md](docs/README.md) | 文档地图、阅读路径与维护规则 | 新增文档时 |

## 快速纪律（详见对应文档）

- UI 一律走语义令牌与 shadcn/ui 组件，禁止裸调色板/手写弹层；改动后跑 `bash apps/web/scripts/audit-ui.sh` 应**全过 10/10**（分节头与「✓ 全部通过」汇总行属正常输出，违规才会计数）
- 创建/编辑表单入口：轻量交互由页头右侧主按钮弹 `Dialog` 承载；需要深链/刷新恢复的长表单（如新建 Issue）走独立短路由页（`/issues/new`），编辑态即详情页本身——两种形态都禁止页内内联展开长表单；不可逆操作必须走 `ConfirmDialog` 二次确认；`IssueTable` 同款表格外壳类名不自由发挥（见 07-ui-guidelines §9）
- 必填字段禁静默兜底默认值：客户端空值置灰提交按钮 + 服务端 zod 双闸；内部枚举值（scope 等）上屏前必须过 label 映射（见 07-ui-guidelines §6.1/6.2）
- 带侧边栏的页面：内容区全宽 `px-8`，禁 `mx-auto max-w-*`；收起/展开切换独立分区单独一行；退出登录不进侧边栏（在顶栏头像菜单）；新增分区 = nav 数组加一行 + 建路由文件夹（见 07-ui-guidelines §7）
- 路由域划分即语境标识：`/w/*`（业务）/ `/admin/*`（治理）/ `/settings/*`（个人偏好）
- **测试纪律**（见 docs/10-testing.md）：改 `apps/web/src/lib`、`apps/web/src/server` 后跑 `pnpm test:coverage` 应全绿（覆盖率 thresholds 只升不降）；纯逻辑配 `apps/web/tests/unit/`，service/路由逻辑配 `apps/web/tests/integration/`（自建 fixture 自清理，不碰种子数据）；关键 UI 旅程在 `apps/web/e2e/`（Playwright，selectors role 优先，须本地起服务后 `pnpm test:e2e` 全过）
- **文档维护纪律**（见 docs/README.md）：文档只描述终态，评审核对/开发日志/历史注记一律不入文档（追溯靠 git 历史）；引用文档前确认目标存在

## 页面路由清单

> 以 `apps/web/src/app/**/page.tsx` 为唯一事实源，本表为快速索引。新增/删除/移动页面时同步更新本表。

| # | 区域 | 路由 | 用途 |
|---|------|------|------|
| 1 | 入口认证 | `/` | 首页 |
| 2 | 入口认证 | `/signin` | 登录页 |
| 3 | 入口认证 | `/change-password` | 修改密码 |
| 4 | 入口认证 | `/auth/wecom/mock` | 企微登录 mock 页（mock 通道启用时；缺省开发态自动开、生产须显式置 1） |
| 5 | 个人账号 | `/me` | 个人中心（登录落地页；含 `/me?ws=` 收窄态） |
| 6 | 工作区·项目 | `/w/[wsSlug]` | 工作区页 |
| 7 | 工作区·项目 | `/w/[wsSlug]/p/[projSlug]` | 项目页（列表/看板双视图） |
| 8 | 工作区·项目 | `/w/[wsSlug]/p/[projSlug]/issues/new` | 新建 Issue |
| 9 | 工作区·项目 | `/w/[wsSlug]/p/[projSlug]/issues/[number]` | Issue 详情（编辑态即此页，含时间线/评论/附件） |
| 10 | 工作区·项目 | `/w/[wsSlug]/p/[projSlug]/settings` | 项目设置页（Tabs：基本信息/状态配置/自定义字段/高级；成员管理内联于「基本信息」，私有项目专用） |
| 11 | 设置 | `/settings` | 设置首页（redirect → `/settings/account`） |
| 12 | 设置 | `/settings/profile` | 个人资料（旧入口，已并入「账号」，redirect → `/settings/account`） |
| 13 | 设置 | `/settings/account` | 账号设置 |
| 14 | 设置 | `/settings/tokens` | API Token 管理 |
| 15 | 管理后台 | `/admin` | 管理首页（redirect → `/admin/users`） |
| 16 | 管理后台 | `/admin/users` | 用户管理 |
| 17 | 管理后台 | `/admin/workspaces` | 工作区管理 |
| 18 | 内部工具 | `/mock/wecom-inbox` | 企微推送 mock 收件箱（同上，随 mock 通道开关） |

路由组 `(name)` 目录不计入 URL，仅用于共享 layout。核心业务「工作区 → 项目 → Issue」三级嵌套共享工作区级 shell；`/me`（账号壳）、`/admin`（治理壳）、`/settings`（偏好壳）各自独立侧边栏，四壳同构不同键（见 07-ui-guidelines §7）。项目路径是否含 `/settings` 子页以路由目录为准（`apps/web/src/app/(app)/w/[wsSlug]/p/[projSlug]/settings/`）。

---

# Agent API 接入

> 本段面向以程序方式操作本系统的 Agent / 自动化脚本，同时就是 LLM 的"工具说明书"。

## 0. 认证

- 所有请求带 `Authorization: Bearer itr_<token>`
- Token 由人类用户在「侧边栏 → API 令牌」创建，**仅创建时可见一次**
- 权限模型：**令牌 scope ∩ 所属用户角色**
  - scope 不足 → `403` `Missing scope: issues:write`
  - 所属用户是 GUEST → 写操作依旧 `403` `Guests have read-only access`
  - 用户被停用 / 令牌过期或撤销 → `401`
  - **错误文案语言**：`error` 消息默认英文，随请求 locale 变化（`NEXT_LOCALE` cookie → `Accept-Language`，协商机制单源 `apps/web/src/i18n/`）。**断言请以状态码 + scope/资源名为准，勿匹配文案原文**；中英文对照见 `apps/web/src/messages/{en,zh}.json` 的 `errors` 命名空间
- **禁区**（Bearer 一律 403）：`/api/auth/*`、`/api/api-tokens*`、`/api/mock/*`、`/api/admin/*`、`/api/workbench`、`/api/notifications`——Agent 无法铸造新令牌、不进治理台与个人视图端点
- 频控：120 次/分钟/令牌 → `429`
- 归因：Agent 的所有动作记录为**令牌所属用户**的 Activity。建议为 Agent 创建专用用户（如「巡检机器人」）再发令牌，避免与真人混淆

**推荐架构**：Agent = 外部进程（LLM + 工具循环），通过本 REST API 读写；MCP 客户端可直接使用本仓库的 npm 包 `solo-issue-mcp`（见 §6）。

## 1. scope 清单

| scope | 允许的操作 |
|---|---|
| `*` | 全部（谨慎使用） |
| `issues:read` | 列出/读取 issue、读取活动流（activities 属 issue 读） |
| `issues:write` | 创建/更新/归档 issue |
| `comments:write` | 发表评论（含 @提及） |
| `comments:read` | 读评论列表 |
| `search:read` | 全局搜索 |
| `activities:read` | 单独预留（当前 activities 随 `issues:read`） |
| `projects:read` | 列项目/状态/成员 |
| `fields:read` | 读自定义字段定义与自描述 JSON Schema |
| `fields:write` | 新建/修改/归档自定义字段（需项目负责人角色） |

scope 推导规则：资源 = 路径中**最后命中的白名单资源段**（issues/comments/...，末段不在白名单时回退母资源），动作 = GET/HEAD→read、其余→write；子资源随母资源 scope（states/workspaces→projects，attachments/activities→issues）。例：`POST /api/projects/:pid/issues/:n/comments` → 需要 `comments:write`；`GET /api/projects/:pid/states` → 需要 `projects:read`。

唯一 scope 豁免：`GET /api/meta`（版本协商端点，solo-issue-mcp 启动自检用）不需要资源 scope，任何有效令牌可读；`/api/health`、`/api/locale` 为探活/偏好端点，完全不经令牌体系。

## 2. 工具清单（按 Agent 视角组织）

约定：`BASE` = 系统根地址（**需含部署 basePath**，默认 `/solo-issue`，可经 `BASE_PATH` 自定义——前缀单一事实源 `apps/web/src/lib/base-path.ts`；线上即 `https://<网关>/solo-issue`）；响应统一 `{ data }` / 错误 `{ error }`；issue 标识用项目内序号（如 `DEMO-12`）。

### search_everything —— 全局搜索（首选发现工具）
```
GET /api/search?q=<关键词>[&cf.<key>=<value>]
→ { projects: [{ id, name, slug, workspace, url }],
    issues: [{ ref, number, title, state, fieldValues, project, url }],
    appliedCustomFilters?, matchedFieldProjects?: [{ projectId, schemaUrl }] }
```
跨工作区检索 issue 标题/描述（命中上限 20 条）与**项目名**（上限 5 条，`q` 为空的纯字段检索时项目组为空数组）；`url` 为可直接给用户的深链（根相对路径——issue → 详情页、项目 → 项目页，拼接 `SOLO_ISSUE_URL` 前缀即绝对地址）。

**CF-5 自定义字段过滤**：`cf.<key>=<value>` 按项目自定义字段过滤 issue（可多个；**同一项目内多字段 AND，字段定义是项目级的——不同项目间命中任一项目的条件即算匹配**）。
- **可检索类型仅 SELECT**（CF-3c）：单选等值/多选包含；含不可检索类型键的项目不参与匹配（见下条门槛）；
- **可省略 `q`**，纯字段检索；`q` 与 `cf.*` 同时缺失才 422；
- 可选值先查 schema（见下）；项目组仅在**完整定义全部过滤键且均为可检索类型**时参与匹配——未定义（或定义成不可检索类型）的项目整组排除，不产模糊命中、不报错；
- 响应带 `fieldValues` 与 `matchedFieldProjects[].schemaUrl`，可据此跳读定义。

### discover_context —— 上下文发现（新建/更新前的准备）
```
GET /api/workspaces/main/projects            → 项目列表（含 issue 计数）
GET /api/projects/:pid/states                → 状态列表（group ∈ ACTIVE/COMPLETED/CANCELLED，三档结局分类；阶段语义看状态名）
GET /api/projects/:pid/fields/schema         → 自定义字段自描述 JSON Schema（CF-5）
GET /api/workspaces/:wsSlug/members          → 成员（assignee 的 userId 来源）
```

**自定义字段（CF-5）**：写 issue 前先读 `/fields/schema`，其 `properties` 即 `fieldValues` 的可写 key 与类型（`required`/`enum` 完整），可直接作为 tool-call 参数的 JSON Schema 校验器：
```json
POST /api/projects/:pid/issues
{ "title": "...", "fieldValues": { "severity": "s1", "customer": "ACME" } }
```
服务端按定义动态校验（类型/枚举/必填/未知 key → 422）；`null` 清空，必填不可清空；变更落 `UPDATED` 活动（`field = custom:<key>`）。

### create_issue
```
POST /api/projects/:pid/issues
{ title, descriptionText?, stateId?, assigneeIds?: [userId], fieldValues? }
→ 201 { data: issue }   // data.number 为项目内序号
```

### update_issue（部分更新，多次调用安全）
```
PATCH /api/projects/:pid/issues/:number
{ title?, descriptionText?, stateId?, assigneeIds?, fieldValues?, isArchived? }
```
- 状态变更写 STATE_CHANGED 活动；到达 `group=COMPLETED` 状态自动记 completedAt
- **通知回路**：指派/@提及/状态变更/评论会自动通知同事（站内 + 企微/IM 渠道），Agent 无需自己发通知

### add_comment（支持 @提及）
```
POST /api/projects/:pid/issues/:number/comments
{ body: { type: "doc", content: [ ... ] } }
```
提及节点格式：`{ "type": "mention", "attrs": { "id": "<userId>", "label": "<姓名>" } }`

### read_issue / read_history —— 审计与上下文
```
GET /api/projects/:pid/issues/:number              → issue 详情
GET /api/projects/:pid/issues?stateId=&assigneeId=&q=&archived=&page=&pageSize=&orderBy=&orderDir=&cf.<key>=<value>
GET /api/projects/:pid/issues/:number/activities   → 活动流（谁在何时改了什么）
```
issue 列表（MCP 工具名 `list_issues`）分页：`page` 1 起、`pageSize` 10–500 缺省 50，**超过缺省页大小的项目会截断**——翻页拉全（响应含 `total`；排序 `orderBy=updatedAt|createdAt`、缺省 `updatedAt` 倒序）。

## 3. 错误与重试

| 状态 | 含义 | Agent 应对 |
|---|---|---|
| 400 | 请求体不是合法 JSON | 修正编码后重发 |
| 401 | 令牌无效/过期/撤销 | 停止并提醒人类重新签发 |
| 403 | scope 不足 / 角色不足 / 禁区 | 不要重试；报告所需 scope |
| 404 | 对象不存在或无权看到 | 当作不存在 |
| 409 | 名称/key 占用冲突（建字段/状态/项目撞名） | 换名重试 |
| 413 | 附件超过 `MAX_UPLOAD_MB` | 压缩或拆分 |
| 415 | Content-Type 非 JSON | 改 `application/json` |
| 422 | 参数校验失败（`error` 有字段明细） | 修正参数 |
| 426 | `solo-issue-mcp` 版本低于服务端下限 | 升级 mcp 包（`npx -y solo-issue-mcp@latest`）后重试 |
| 429 | 触发频控 | 按 Retry-After 等待；批量操作加 500ms 间隔 |
| 5xx | 服务端错误 | 指数退避重试 ≤3 次 |

幂等性：`update_issue` 为部分更新语义，可安全重试；`create_issue` 无幂等键，**重试可能造成重复**——失败后先 search 确认再补建。

## 4. 最佳实践

1. **专用用户**：为每个 Agent 建独立用户（apps/web/scripts/ops-add-user.ts），活动时间线的归因才可读
2. **最小 scope**：只申请需要的（巡检类 Agent 通常 `issues:read` + `search:read` 就够）
3. **限期令牌**：优先 30/90 天过期，轮换而非永生
4. **批量限速**：循环操作加间隔，远离频控线
5. **写入前先读**：更新前 GET 详情，避免覆盖并发变更

## 5. 参考实现

`apps/web/scripts/verify-agent.ts` —— 完整端到端验收样例（建令牌→发现上下文（含 scope 映射回归）→建 issue→评论→读活动→搜索→通知验证→安全负例→撤销），可直接改造成你的 Agent 骨架。

`apps/web/scripts/verify-mcp.ts` —— MCP 包 × REST 契约矩阵验收（`pnpm verify` 管道自带）：全工具正向 + 启动/令牌/校验/频控负例 + 426 版本闸对照；契约变更合并前必须经它全绿（设计见 [docs/11-mcp-adapter.md](docs/11-mcp-adapter.md)）。

## 6. MCP 接入（solo-issue-mcp）

本仓库自带 MCP 服务器 npm 包 `solo-issue-mcp`（实现于 `packages/mcp`）：纯透传的协议适配层，工具面是本文件 §2 工具清单的 1:1 镜像，权限/校验/频控语义与本文档逐条一致。主流客户端两条环境变量即用：

```json
{
  "mcpServers": {
    "solo-issue": {
      "command": "npx",
      "args": ["-y", "solo-issue-mcp@latest"],
      "env": {
        "SOLO_ISSUE_URL": "https://<host>/solo-issue",
        "SOLO_ISSUE_TOKEN": "itr_…"
      }
    }
  }
}
```

- **前置**：`SOLO_ISSUE_URL` 须含部署 basePath（默认 `/solo-issue`，随部署的 `BASE_PATH` 配置）；令牌按 §0 签发（推荐最小 scope + 限期）；多部署 = 多个命名实例
- **详细文档**：安装/各客户端配置/Windows 变体/多实例/sample 排障，单源于 `packages/mcp/README.md`
- **版本保障**：包启动自检走 `GET /api/meta`（§1 的唯一 scope 豁免端点）；部署服务端按 `X-Client` 头对低于下限的包直接 426（见 §3）——升级即修复
- **发布支持窗口**：每个契约版本对 MCP 包保持 n-2 minor 兼容；破坏性变更的定级与升位口径单源于 [docs/11-mcp-adapter.md](docs/11-mcp-adapter.md) §5
