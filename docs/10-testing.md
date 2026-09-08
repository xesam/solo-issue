# 10 · 测试体系

> 分层测试的约定：跑什么命令、每层测什么、覆盖率门槛在哪。写任何 `apps/web/src/lib`、`apps/web/src/server` 与关键 UI 旅程代码前先读本文。

## 1. 总览：五层质量防线

| 层 | 工具 | 运行时机 | 覆盖对象 |
|---|---|---|---|
| 单元测试 `apps/web/tests/unit/` | Vitest（`project: unit`） | 本地快速回路 + `pnpm verify` 全量 | 纯逻辑：校验/scope 推导/字段注册表/限流/标签映射等，无 DB、无网络、无请求上下文 |
| 集成测试 `apps/web/tests/integration/` | Vitest（`project: integration`，DB 直连） | 本地 + `pnpm verify` 全量 | service 层 + 权限矩阵 + 通知派生，真实 Prisma、自建 fixture 自清理 |
| 端到端 `apps/web/e2e/` | Playwright（chromium 单浏览器） | `pnpm verify` 全量 + 本地按需 | 关键 UI 旅程：mock 登录/创建（含空值置灰）/状态流转与时间线/评论 @提及/跨用户通知/全局搜索深链 |
| 验收脚本 `apps/web/scripts/verify-*.ts`、`verify-smoke.sh` | tsx / bash（直连或 HTTP） | `pnpm verify` 全量 + 部署后冒烟 | 契约级端到端：verify-agent（Agent API 面）、verify-mcp（MCP 包 × REST 契约矩阵，stdio 起包驱动全工具 + 启动/403/422/429 负例，设计见 [11-mcp-adapter.md](11-mcp-adapter.md)）、verify-custom-fields（自定义字段）、verify-workbench/verify-account（有副作用，不在 verify-all 编排内）、verify-smoke（部署冒烟） |
| 静态审计 `apps/web/scripts/audit-ui.sh` | grep 规则 | UI 改动后 | UI 规范 10 项检查（见 [07-ui-guidelines.md](07-ui-guidelines.md) §8） |

命令入口（`package.json`）：

| 命令 | 语义 |
|---|---|
| `pnpm test` | 全量：unit + integration（verify 门禁走的是同两层的 `test:coverage`，多含覆盖率门槛校验） |
| `pnpm test:unit` / `pnpm test:integration` | 单层回路 |
| `pnpm test:watch` | unit 增量回路（改代码即时重跑） |
| `pnpm test:coverage` | 全量 + 覆盖率度量 + thresholds 硬校验（verify-all 用这个当门禁） |
| `pnpm test:e2e` | Playwright 关键旅程（复用已起服务；verify-all 内含此步） |

集成测试前置：`DATABASE_URL` 可用的 Postgres（与开发库同库无妨，见 §3 fixture 纪律）。环境缺失时 setup 阶段即红，并给出修法提示。

## 2. 单元测试（apps/web/tests/unit/）

边界纪律：**不 import 会触发 DB 连接或 `next/headers` 的模块链**。纯函数 + 哨兵 mock（如 `api-server.test.ts` 对 `@/i18n/server` 的透传替身）。

当前覆盖面：

| 模块 | 锚定的契约 |
|---|---|
| `lib/api.ts` | `{ data }` / `{ error }` 形状契约；HTTP 状态语义（401/403/404/415/422/429/rate 4xx600）；`parse` 的 zod→422；路径参数守卫 |
| `lib/api-server.ts` | 统一错误出口：HttpError/ValidationError/未知异常三分支的 status、headers、翻译链 |
| `lib/validations.ts` | 全部路由入参 schema：分页区间、cf 前缀收集、空值拒收等 |
| `lib/scopes.ts` scope 推导 | 资源段→scope 映射、GET/HEAD=read、末段回退母资源 |
| `lib/api-contract.ts` | 契约版本单源：`API_CONTRACT_VERSION`/`MIN_MCP_VERSION`、`X-Client` 版本解析与 426 判定（fail-open 于非自家头；端到端断言在集成层 auth-token.test.ts） |
| `lib/dto.ts` | issue 列表 DTO 装配 |
| `server/custom-fields/registry.ts` | 字段值动态校验矩阵（类型/枚举/必填/未知 key/SELECT 单多选/归档选项） |
| `server/custom-fields/notify-rules.ts` | 通知规则推导 |
| `server/rate-limit.ts` | 窗口语义、清扫分支、`TRUST_PROXY` 下 XFF 采信规则 |
| `lib/tiptap-text.ts` | 富文本→纯文本派生（列表前缀/提及/图片/换段） |
| `lib/origin-labels.ts` / `lib/notification-labels.ts` | 内部枚举→人话的 label 映射（07 §6.2 纪律） |
| `lib/base-path.ts` / `lib/utils.ts` / `session.ts`(纯函数部分) | basePath 拼接、归并、cookie 项 |

## 3. 集成测试（apps/web/tests/integration/）

固定设施：

- `setup.ts`：环境守卫（`DATABASE_URL` 检查 + 连通探测）；`UPLOAD_DIR` 重定向到临时沙箱（附件测试不落仓库目录）
- `helpers.ts`：fixture 工厂（`mkUser` / `mkWorkspace` / `mkProject` / `addMember`）+ 清理登记簿
- IM 队列隔离：所有会触发通知派生的测试文件**顶部** `vi.mock("@/server/queue")`——测试不把 pg-boss job 留在真实队列（站内通知断言不受影响；队列本身属部署冒烟职责）

fixture 纪律（对共享开发库安全的保证）：

1. **只建自己的**：用户名/邮箱/slug 一律 `uid()` 随机前缀，绝不读写 seed 数据（管理员、main 工作区）
2. **自清理**：所有行进 `helpers` 登记簿，`afterAll(cleanupFixtures)` 统一删；删除顺序 = workspace（级联成员/项目/issue/评论/活动/通知）→ user（级联会话/令牌）
3. **全局护栏类断言**：凡依赖「全库只有 N 个管理员/OWNER」的护栏（`lastActiveAdmin`）不在集成测试造红——共享库有种子管理员；工作区 OWNER 维度的护栏（`lastWorkspaceOwner`）因作用域隔离可测已测
4. **请求上下文哨兵**：会话/页面上下文（`session-pages.test.ts`）用 `vi.mock("next/headers")` 注入可控 cookie jar、`vi.mock("next/navigation")` 注入哨兵错误断言 `redirect`/`notFound`——真实 DB 行为 + 上下文形状双真

当前覆盖面：Bearer 令牌矩阵（铸造/过期/停用/禁域/scope 不足/429 限流）、权限矩阵（角色 × 项目可见性 × 读/写/管理三级）、issue 全生命周期（序号/状态机/completedAt/活动/通知派生/批量/归档/检索/自定义字段过滤）、评论与时间线合并、通知偏好解析、附件与存储沙箱、管理台服务（建号/改键/停用吊销/角色治理）、个人工作台聚合、密码与会话全流程（bcrypt 散列、防枚举恒时比较的非炸分支——恒时性本身从公开接口不可观测，防退化靠实现注记与 code review）。

## 4. 端到端（apps/web/e2e/，Playwright）

只测**跨页面关键旅程**——单点逻辑归单元、service 行为归集成，E2E 不重复覆盖。当前旅程矩阵（每条 spec 对应走查验证过的路径）：

| spec | 旅程锚点 |
|---|---|
| `auth.spec.ts` | mock 通道登录 → `/me` 落地；退出回 `/signin` |
| `issue-create.spec.ts` | 新建页空值置灰 → 创建并返回 → 列表/看板可见 → UI 删除（含编号强校验 ConfirmDialog） |
| `issue-state.spec.ts` | 待处理池 → 进行中 → 已完成，时间线逐条落痕 |
| `comment-mention.spec.ts` | 评论框 @提及（弹层 `role=listbox/option`）→ 跨用户 MENTIONED 通知闭环（描述路径的提及通知走 `issue.ts` 另一分支，暂无 e2e 接线） |
| `global-search.spec.ts` | ⌘K 检索 → 回车与点击双路径深链 |

运行形态（`playwright.config.ts` 单源）：

- `webServer` 探活 URL 与页面路径分别经 `playwright.config.ts` / `e2e/utils.ts` 的 `appUrl()` 拼接 basePath（默认 `/solo-issue`，随部署的 `BASE_PATH` 走）；`E2E_ROOT`（默认 8081）上已起的服务（dev 或 `pnpm start`）被复用，`pnpm verify` 由 verify-all.sh 先行起服后由此探测就绪
- 登录身份（企业微信1/2）由 `pnpm verify:seed` 幂等预置（含 WECOM Identity 行，口径见 `apps/web/src/server/im/wecom/mock.ts`），名单与 `apps/web/e2e/utils.ts` 同步维护
- `workers: 1`：单服务单库，旅程串行防串台；`retries: 0`——失败即真失败，不做抖动重试
- 失败自动留 trace 与截图，报告落 `playwright-report/`（本地留存）

纪律：

1. **数据只碰自己的**：标题带 `E2E-<spec>-<ts>` 唯一前缀，结束后一律 UI 删除清理；spec 内另有 DB 直清 sweep（`apps/web/e2e/fixtures.ts`）在 beforeEach 吸收历史残渣、afterEach 兜失败路径，中断残留由 `apps/web/scripts/ops-cleanup.ts` 人工兜底；不读写种子数据（demo 项目与种子用户仅作容器/登录身份）
2. **选择器 role 优先**：@提及候选弹层与全局搜索结果区实现为 `role="listbox"`/`option`（UI 契约，改动须同步 e2e 断言）；aria-label 全站齐备是选择器库的基础盘
3. **不追交互长尾**：看板拖拽、弹层键盘全交互等高 flake 面不进矩阵，走人工/走查兜底（走查产物见 `docs/07-ui-guidelines.md` 审计域）

## 5. 覆盖率面板（vitest.config.ts 单源）

度量范围 = `apps/web/src/lib/**` + `apps/web/src/server/**`，四类面板如实计入分母（不通过排除刷数字）：

| 状态 | 面板 | 回执来源 |
|---|---|---|
| **计入** | `services/auth-im.ts`、`services/im-send.ts`（0% 属实） | IM 渠道外部 HTTP 契约，联调冒烟背书（见 [09-wecom-setup.md](09-wecom-setup.md)） |
| **计入** | `services/custom-field.ts`（验收脚本背书） | verify-all 的 verify-custom-fields 覆盖其端到端行为（全量断言面以脚本为准），vitest 不重复收录 |
| **排除** | `apps/web/src/lib/client/**`（React hooks 层） | UI 行为由 E2E/smoke 背书（关键旅程） |
| **排除** | `apps/web/src/server/im/**`（渠道适配器） | 同 auth-im/im-send |
| **排除** | `apps/web/src/worker/**`、`apps/web/src/server/queue.ts` | 进程编排与队列基础设施，测试内全部 mock 隔离，部署冒烟背书 |

当前门槛（`coverage.thresholds`）与水位：

| 门槛 | lines / functions / branches / statements | 语义 |
|---|---|---|
| `apps/web/src/lib/**` | 95 / 90 / 85 / 95 | 纯逻辑面近乎全覆盖 |
| `apps/web/src/server/auth/**` | 88 / 85 / 80 / 88 | 认证域是最高风险面 |
| `apps/web/src/server/custom-fields/**` | 88 / 85 / 80 / 88 | 字段注册表可校验性 |
| `apps/web/src/lib/api.ts` | 95 / 90 / 90 / 95 | 契约单源 |
| `apps/web/src/server/rate-limit.ts` | 88 / 85 / 75 / 88 | 暴力尝试防线 |
| 全局兜底 | 75 / 70 / 65 / 75 | 服务层整体水位（含 0% 属实面板） |

## 6. 门槛是一条只升不降的回归防线

- 门槛数值 = 实测水位减 3–5 个点的安全边际，防止无关抖动（分支微调、generator 变化）撕坏门禁
- **只许上抬不许下调**：下调必须伴随等价补偿（如把某面板移到验收脚本背书并在本文 §5 写明），且在提交流里单独成段说明
- verify-all 用 `pnpm test:coverage` 硬校验：任一门槛不满足即整轮红；覆盖率 HTML 报告落 `coverage/` 用于定位

## 7. 新增代码时的测试要求

| 新代码类型 | 必须配的测试 | 判据 |
|---|---|---|
| 纯逻辑（lib/校验/推导/映射） | `apps/web/tests/unit/` | 模块行覆盖不拉低 `apps/web/src/lib/**` 门槛 |
| service / 路由处理逻辑 | `apps/web/tests/integration/`（走 service 直连；协议层语义由验收脚本/E2E 背书） | 覆盖行为不改全局兜底门槛走势 |
| 会话/请求依赖 | 哨兵 mock 模式（见 §3 做法） | 不得为绕测试降低访问控制强度 |
| UI | 关键旅程配 `apps/web/e2e/` spec；`audit-ui` 10/10 | E2E 数据自清理纪律同 §4 |

提交前固定回执：`pnpm typecheck && pnpm test:coverage` 全绿。

## 8. 本地一键门禁（`pnpm verify`）

`pnpm verify`（`apps/web/scripts/verify-all.sh`）一键复刻全量管道：**Docker 一次性 postgres** → 迁移 → 种子 → 验收数据（`pnpm verify:seed`）→ typecheck → **test:coverage（含门槛）** → build → 起服（生产形态，`VERIFY_PORT` 默认 8091）→ 健康检查 → 验收脚本（verify-custom-fields + verify-agent + verify-mcp）→ **E2E（chromium 幂等安装 + test:e2e）** → 收尾清理（停服、销毁临时库——成败皆清）。

- 无平台 CI，触发完全人为：建议合入 main 前择机执行；日常快回路提交回执 = `pnpm typecheck && pnpm test:coverage`（§7）
- 临时库 + 独立端口 + 生产构建起服，保持受控环境语义；本地 dev server 会被先停（build 与 dev 并发写 `.next` 互损），结束后 `pnpm dev:restart` 恢复
- 管道环境全部由脚本接管（`DATABASE_URL` / `PORT` / `APP_URL` / `E2E_ROOT` / `ALLOW_DEV_LOGIN` / `ALLOW_IM_MOCK` / `ADMIN_EMAIL` / `ADMIN_INIT_PASSWORD` / `DEMO_PROJECT`——后三者防本地 `.env` 定制渗入临时库），不落盘、不污染 `.env`
