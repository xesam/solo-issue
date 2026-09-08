# 文档索引与维护规则

> docs/ 的阅读入口：先在这里搞清楚「读什么、按什么顺序读」。新文档加入时必须同步更新本文。

## 1. 系统一分钟概览

**solo issue** 是一个单机自部署的轻量级问题追踪（Issue Tracker）系统，个人本地与团队服务器同一套部署：

- **业务结构**：工作区 → 项目 → Issue 三级嵌套；状态三档结局分类、看板/列表双视图、保存视图、项目级自定义字段
- **部署形态**：Next.js 15 单体（页面与 API 同进程）+ 异步 worker + PostgreSQL（15/16）；Docker Compose 或直接在服务器上运行两种等价路径，单机到服务器不变形
- **登录**：邮箱密码为基线，**不接 IM 也完整可用**；可选接入企业微信（客户端内静默免登 / PC 扫码；钉钉/飞书预留 adapter 位）
- **通知**：站内通知常备；接入企微后同步推送应用消息。所有通知由完整的操作记录派生——每个变更都被记录下来，是系统的唯一事实源
- **AI Agent 友好**：REST API + Bearer 令牌（权限 = scope ∩ 所属用户角色）、字段自描述 JSON Schema、结构化活动审计（接入说明见根目录 [AGENTS.md](../AGENTS.md)）；附带 MCP 服务器包 `solo-issue-mcp`（stdio，npm 分发，实施与发布状态见 [11-mcp-adapter.md](11-mcp-adapter.md)）

明确不做：迭代/路线图/甘特、工时估点、行级权限、实时协同、邮件通知（详见 [01-architecture.md](01-architecture.md) §2.2）。界面文案为 en/zh 双语（`messages/*.json` 单源），暂不做更多语种。

## 2. Quickstart（从零到能跑通）

### 2.1 环境要求

| 项 | 要求 |
|---|---|
| Node | ≥ 22 |
| pnpm | 仓库锁定 pnpm@11.10.0（corepack 自动生效） |
| PostgreSQL | 15 或 16 均可（本地可只起一个库容器：`docker compose up -d postgres`；Compose 默认 15-alpine） |
| Docker | 仅 Compose 部署需要；本地开发可不用 |

### 2.2 本地启动

```bash
cp apps/web/.env.example apps/web/.env          # 本地最小配置：只需改 DATABASE_URL 指向你的 Postgres
pnpm install
pnpm dev:up                 # 一键冷启动：确保 Postgres（缺容器时自动起 compose 的 postgres）→ 建表 → 种子 → 后台起 dev + worker
```

打开 http://localhost:8081/solo-issue 即可开发（应用挂在部署前缀之下，默认 `/solo-issue`，可经 `BASE_PATH` 自定义——裸根路径 404）；worker 由 `dev:up` 后台带起（IM 通知分发 + 会话清理，不跑只影响 IM 推送）。

- **登录**：开发环境 `ALLOW_IM_MOCK` 未显式设置时默认开启——登录页走「企微模拟通道」（虚拟通讯录）；或用 `ALLOW_DEV_LOGIN` 做邮箱直登（未设置时非生产默认开、生产默认关）
- **进程**：`pnpm dev` 前台跑应用（想实时盯日志时用）；后台托管 `pnpm dev:restart` / `pnpm dev:stop`（参数 `dev` / `worker` / `all`；日志 `.dev-server.log` / `.worker.log`）
- **数据库**：`pnpm db:migrate` 是开发期动词（改 `schema.prisma` 后生成新迁移，有交互确认）；建表/同步由 `dev:up` 内置的 `db:deploy` 承担（非交互幂等）。本地库脏了想重来：`pnpm db:reset`（清库重放迁移 + 自动种子，执行前有确认提示）
- **改端口**：`apps/web/.env` 的 `PORT`（Docker 部署改用 `APP_PORT` 控制宿主机映射，容器内固定 3000）
- **提交前检查**：`pnpm typecheck && pnpm test:coverage` 应全部通过；合入主分支前建议 `pnpm verify` 跑完整门禁（见 [10-testing.md](10-testing.md) §7/§8）
- ⚠️ 开发服务器运行中勿跑 `pnpm build`：并发写 `.next` 可能损坏开发进程，`pnpm dev:restart` 可恢复

### 2.3 配置管理员

- **出生**：seed 可带 `ADMIN_EMAIL`（管理台登录键，缺省占位 `solo-issue@github.com`）与 `ADMIN_INIT_PASSWORD`（初始密码，首登强制改密；不设则管理员无密码，初期靠开发登录/企微通道进入）
- **上线前必做**：管理台「用户 → 编辑」把占位邮箱改为真实邮箱 → 接企微（[09-wecom-setup.md](09-wecom-setup.md)）→ 关闭 `ALLOW_DEV_LOGIN`
- **找回/重置**：`pnpm -C apps/web exec tsx scripts/ops-set-password.ts <email>` 设新密并吊销全部会话（细节见 [03-auth.md](03-auth.md) §6；IM 建号账号走「管理台补写邮箱 → 重置密码」）

### 2.4 上线路径

- 单机部署（Docker Compose / 直接在服务器上运行 / 备份 / 升级 / 排障）→ [08-deployment.md](08-deployment.md)
- 企微正式接入（前置 / 凭证 / 应用配置 / 免登与扫码双路径冒烟）→ [09-wecom-setup.md](09-wecom-setup.md)

## 3. 文档地图

> 文件名的两位序号前缀即推荐阅读顺序（README 固定为入口、无前缀）。

| 层 | 文档 | 内容 | 何时读 |
|---|---|---|---|
| **入口** | 本 README | Quickstart / 概览 / 地图 / 维护规则 | 第一步 |
| **方案层**（系统是什么、为什么这样设计） | [01-architecture.md](01-architecture.md) | 目标与设计原则 / 技术选型 / 系统架构 / 通知设计 / 扩展预留 / 设计取舍与适用边界 | 新人第一份；评估方案时 |
| | [02-data-model.md](02-data-model.md) | ER 总览 / 数据模型语义与不变量 / 身份模型 / 关键决策 | 看/改 schema 前 |
| | [03-auth.md](03-auth.md) | 登录双通道 / IM OAuth 流程 / 渠道 Provider 接口 / 恢复预案 / mock 通道 | 改认证、接 IM 渠道时 |
| | [04-workspace-design.md](04-workspace-design.md) | 工作区 = 权限原语：边界 / 可见性公式 / 治理 / 能力矩阵（权限口径单源） | 涉及权限、工作区边界时 |
| | [05-custom-fields.md](05-custom-fields.md) | 自定义字段：类型注册表 / 写入链路 / 过滤 / Agent 面 | 涉及项目字段、Issue 表单时 |
| | [11-mcp-adapter.md](11-mcp-adapter.md) | MCP 适配器设计：npm 包分发 / 工具面映射 / 契约版本与双重保障 | 维护 MCP 适配器/契约定级时 |
| **规范层**（动手改之前必须遵守） | [06-api-contract.md](06-api-contract.md) | 全部 `/api/*` 路由 / 分页排序约定 / 错误语义 | 改 API 前后 |
| | [07-ui-guidelines.md](07-ui-guidelines.md) | 设计令牌 / 组件规则 / 四壳布局 / 弹框表格范式（含防回退护栏） | 改任何 UI 前后 |
| | [10-testing.md](10-testing.md) | 测试体系：分层防线 / 单测与集成边界 / 覆盖率门槛 / 本地一键门禁 | 写测试、改 lib/server 代码前后 |
| **运维层** | [08-deployment.md](08-deployment.md) | 部署与运维指南：部署前两种路径 / 环境变量全表 / 权限速览 / 安全基线 / 备份恢复 / 升级 / 排障（使用者向全指南）| 部署/运维时 |
| | [09-wecom-setup.md](09-wecom-setup.md) | 企微正式接入：前置 / 凭证 / 应用配置 / 免登与扫码冒烟 | 接企微时 |

以程序方式操作本系统的 Agent 工具说明（认证 / scope / 端点 / 错误语义 / 最佳实践）在根目录 [AGENTS.md](../AGENTS.md)，不在本目录重复收录。

## 4. 推荐阅读路径

- **新成员上手**：本 README → 01-architecture → 02-data-model → 04-workspace-design → 按第一个任务读对应领域文档
- **评估方案**：根 [README](../README.md) → [01-architecture.md](01-architecture.md)（架构与设计取舍）→ [08-deployment.md](08-deployment.md)
- **改后端**：06-api-contract（改动路由前后）+ 02-data-model（涉及表时）+ 10-testing（配测试）
- **改前端**：07-ui-guidelines 全篇 + 对应页面的现有实现
- **部署上线**：[08-deployment.md](08-deployment.md) → 09-wecom-setup（接企微时配合 03-auth.md）

## 5. 维护规则

> `docs/P00-project/`（logo 素材）、`docs/R01-rfc/`（RFC 草案，如人机共生 Bot）与 `docs/R02-issue/`（待处理问题单，一个问题一份文档，文件名 `SNN-名称.md`）为非编号资料目录，不入阅读路径与维护表；RFC 落地后其内容合入编号文档并归档。

1. **只描述终态**：文档写「系统现在是什么」；历史注记、评审记录、开发日志一律不入文档——追溯靠 git 提交历史。
2. **单一事实源**：同一事实只在一处展开叙述，其余位置用链接指过去——能力矩阵在 04-workspace-design、自定义字段细节在 05-custom-fields、数据库 schema 的现役定义就是 `apps/web/prisma/schema.prisma` 本身（文档不整体复制代码，防止漂移）。
3. **文件名序号前缀**：正文文档一律 `NN-名称.md`（两位序号，小写命名法），序号按推荐阅读顺序排列；README 固定为入口、无前缀。新增文档取当前最大序号 +1；调整序号属文件移动，须走规则 4 的引用同步。
4. **互链有效**：引用其他文档前先确认目标存在；新增/删除/移动文档（含改序号）时，同步更新本索引、其他文档的引用点与根目录 AGENTS.md。
5. **行为与文档一致**：改动改变了文档描述的行为时，同一批提交里更新文档，不允许文档与实现分叉。
