# API 契约

> 系统全部 `/api/*` 路由的现役清单与约定。改动路由前后必读。
> 认证流程与登录方式设计见 [03-auth.md](03-auth.md)；Agent 以程序方式接入（Bearer/scope/错误语义/最佳实践）见根目录 [AGENTS.md](../AGENTS.md)。

## 1. 统一约定

- 成功 `{ "data": ... }`，失败 `{ "error": string }`；未登录 `401`，权限不足 `403`，不存在/不可见 `404`，校验失败 `422`，`solo-issue-mcp` 版本低于服务端下限 `426`（仅对带自家 `X-Client` 头的请求生效）；`409` 命名/占用冲突（状态名、项目/字段 key 等对象创建与改动撞名）；`413` 附件超过 `MAX_UPLOAD_MB`；另有 `400`（请求体非合法 JSON）与 `415`（非 JSON content-type，见 `apps/web/src/lib/api.ts` readBody）。唯一例外：`/api/health` 为探针契约，直接返回裸 JSON 不走 `{ data }` 包络
- `error` 文案默认英文，随请求 locale 变化（`NEXT_LOCALE` cookie → `Accept-Language`，出口统一在 `apps/web/src/lib/api-server.ts` handle，对照表 `apps/web/src/messages/{en,zh}.json`）。**消费方应按状态码判定语义，勿匹配文案原文**
- 鉴权双通道：会话 `it_session` httpOnly Cookie（人类）/ `Authorization: Bearer itr_*`（Agent，scope 判定见 [AGENTS.md](../AGENTS.md)，`/api/auth/*`、`/api/api-tokens*`、`/api/mock/*`、`/api/admin/*`、`/api/workbench`、`/api/notifications` 为 Bearer 禁区或会话专用）
- 防枚举口径：非工作区成员与「不存在」同样返回 404，不泄露可见性之外的存在性（见 [04-workspace-design.md](04-workspace-design.md) §8）

## 2. 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` → 会话；防枚举（统一文案/恒时比较）；停用 403；首登返回 `mustChangePassword` |
| POST | `/api/auth/dev-login` | `{ email }` 直发会话。仅 `ALLOW_DEV_LOGIN` 开启时可用（403 关闭）：显式设置优先；未设置时非生产默认开、生产默认关（初始化/救急临时用） |
| POST | `/api/auth/logout` | 销毁会话 |
| GET | `/api/auth/me` | 当前用户 + 所属工作区。**强制改密态**下本端点同样 403（`requireApiUser` 统一拦），可达的只有 `PUT /api/auth/password`（`getSessionUser` 通道）与 `POST /api/auth/logout`（逃生通道，改密态不拦退出）——UI 依赖登录响应中的 `mustChangePassword` 跳转 `/change-password` |
| PUT | `/api/auth/password` | 自助改密 `{ currentPassword, newPassword }`；吊销其他会话；**无密码账号（IM 建号）403 "no password set, password change is not supported"**（UI 侧同步禁用） |
| GET | `/api/auth/providers` | 登录方式探测（各渠道 `supportedFlows`，企微入口开关） |
| GET | `/api/auth/wecom/start` | 企微客户端内静默免登入口（snsapi_base） |
| GET | `/api/auth/wecom/web-start` | 系统浏览器（PC）wwlogin 扫码入口；mock 模式回落站内模拟页。与 start 双入口同 callback（`flow` 区分） |
| GET | `/api/auth/wecom/callback` | OAuth 回调（state 校验 → 身份解析：命中即登录，未命中首登建号（origin=WECOM、不写 email）→ 建会话） |
| GET | `/api/auth/sessions` | 我的会话列表 |
| POST | `/api/auth/sessions/revoke-all` | 吊销其他全部会话（保留当前） |
| GET | `/api/auth/mock/users` | 模拟企微通讯录成员列表（仅 `ALLOW_IM_MOCK`；Bearer 禁区）。**仅含 origin=WECOM 账号**——邮箱建号账号不列出（其 code 解析同样拒绝）；「新同事」不经此 API——授权页表单构造 `mock:new:<name>` 直走企微首登建号链路 |

## 3. 工作区与项目

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/workspaces` | 我的工作区列表 |
| GET | `/api/workspaces/:wsSlug/members` | 成员列表（负责人选择器；user 画像含 `origin` 建号来源） |
| GET | `/api/workspaces/:wsSlug/projects` | 项目列表（含 issue 计数与 `latestActivityAt`；私有项目按可见性过滤） |
| POST | `/api/workspaces/:wsSlug/projects` | `{ name, slug?, isPrivate? }`，自动创建 5 个默认状态，创建者自动成为项目 `ADMIN`（响应为新建项目本体，`latestActivityAt` 仅列表接口计算）。**工作区负责人（OWNER）** |
| GET | `/api/projects/:projectId` | 项目详情 |
| PATCH | `/api/projects/:projectId` | `{ name?, isArchived?, isPrivate? }`；**项目负责人**（`requireProjectAdmin`） |
| DELETE | `/api/projects/:projectId` | 删除项目，**仅项目 ADMIN ∨ 工作区 OWNER**；护栏：项目须 0 issue（前端二次确认需输入 slug） |
| GET/POST/DELETE | `/api/projects/:projectId/members` | 私有项目成员管理（ADMIN/MEMBER/GUEST）；user 画像含 `origin`（与 `USER_LITE` 口径一致）；`DELETE ?userId=` 移除 |
| GET/POST/DELETE | `/api/projects/:pid/views`、`/views/:viewId` | 保存视图：读 = 项目可见成员（GUEST 可读），写 = MEMBER+；`GET` 列表 / `POST` 创建 / `DELETE` 删除；无更新端点 |

## 4. 状态

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/:projectId/states` | 状态列表（项目可见成员） |
| POST | `/api/projects/:projectId/states` | `{ name, color?, group? }`，group ∈ `ACTIVE`/`COMPLETED`/`CANCELLED`（三档结局分类）；**项目负责人**（状态是影响全项目的工作流定义，与字段定义同档） |
| PATCH/DELETE | `/api/projects/:projectId/states/:stateId` | **项目负责人**；改名重名 → 409；删除要求状态下无 issue |

> 标签不是主干概念，由多选 SELECT 自定义字段承接（`settings.multiple`，见 [05-custom-fields.md](05-custom-fields.md) §3.3）。

## 5. 自定义字段

> 完整设计（类型注册表/写入链路/扩展步骤/取舍）见 [05-custom-fields.md](05-custom-fields.md)；本节只记契约。定义（项目级）与值（`Issue.fieldValues`，JSONB + GIN 索引）分离；key 与 type 创建后不可变，删除 = 归档软删。

### 5.1 定义管理

- **读取**（GET `/fields`、`GET /fields/schema`）：项目可见成员
- **写操作**（POST/PATCH/DELETE、历史、导入导出）：项目负责人

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/:projectId/fields` | 启用字段列表；`?archived=1` 含归档 |
| POST | `/api/projects/:projectId/fields` | `{ key, name, type, options?, settings?, isRequired?, sequence? }`；`key` 为 snake_case，`type ∈ TEXT\|NUMBER\|DATE\|SELECT\|USER` |
| PATCH | `/api/projects/:projectId/fields/:fieldId` | 改名/必填/选项/排序；`version` 自增并落定义快照 |
| DELETE | `/api/projects/:projectId/fields/:fieldId` | **归档软删**（`isArchived=true`，不硬删；历史值保留，表单不再出现，不再参与必填校验）；幂等 |
| GET | `/api/projects/:projectId/fields/:fieldId` | 定义变更历史（最近 50 版快照） |
| GET | `/api/projects/:projectId/fields/export` | 导出声明式 JSON `{ version: 1, fields: [...] }`（全量含归档） |
| POST | `/api/projects/:projectId/fields/import` | `{ fields: [...] }` 按 key 增量合并：新建/更新（name/options/settings/isRequired/sequence），**已存在且 `type` 不一致则跳过**（返回 `skipped[]` 带原因）；返回 `{ created, updated, skipped }` |

**项目负责人** = 项目 `ProjectRole.ADMIN` ∨ 工作区负责人 `OWNER`（`requireProjectAdmin`）。

### 5.2 自描述 JSON Schema（项目可见成员）

`GET /api/projects/:projectId/fields/schema` 返回可直接作为 tool-call 参数校验器的 JSON Schema：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Issue.fieldValues",
  "type": "object",
  "properties": {
    "severity": { "type": "string", "enum": ["s1", "s2"] },
    "customer": { "type": "string", "maxLength": 2000 }
  },
  "required": ["customer"],
  "additionalProperties": false,
  "x-fields": [{ "key": "severity", "name": "严重等级", "type": "SELECT", "options": [] }]
}
```

- 写 schema 口径：仅含**启用**字段；`required` = 必填；`additionalProperties: false`（未定义 key 服务端 422，与运行时一致）；`?archived=1` 时含归档字段的元信息
- `x-fields` 为非标准扩展键，携带展示元信息供 UI/Agent 读；与 `/fields`（管理视图，含 id/审计字段）职责分离——`/fields` 给人看，`/schema` 给机器消费

### 5.3 值写入与校验

`POST/PATCH .../issues` 接受 `fieldValues: { <key>: value }`，服务端按定义动态校验：类型/枚举/必填/未知 key 一律 422；`null` 表示清空，必填字段不允许清空；更新为部分写入（与既有值合并）；已软删选项的存量值放行、新选被拒。USER 类型写值必须过成员可见性护栏（与指派人同一护栏 `assertUsersVisible`）。变更逐字段落 `UPDATED` 活动（`field = custom:<key>`），字段级通知规则（`settings.notifyOn`）在值命中时触发——DSL 与行为细节见 [05-custom-fields.md](05-custom-fields.md) §5。

### 5.4 字段过滤与列表列

- `GET /api/projects/:projectId/issues` 支持 `cf.<key>=<value>`（可多个，AND 语义；`cf.` 前缀与固定参数命名空间隔离）。**可检索类型仅 SELECT**：单选等值、多选包含（`array_contains`）；其余类型参数静默忽略、退化为不过滤；未定义 key 忽略而非报错（字段删/改名后旧链接退化为不过滤）
- `GET /api/search` 跨项目字段过滤：允许**省略 `q`**（纯字段检索），`q` 与 `cf.*` 同时缺失才 422；按项目分组各自用本地定义归一化，项目间 **OR**；参与门槛为项目**完整定义全部过滤键且均为可检索类型**，部分定义/不可检索类型的项目**整组排除**（与项目内列表的「未定义 key 退化不过滤」刻意不同——跨项目检索不允许模糊命中）；字段过滤**仅作用于 issue 分组**——项目分组仅在 `q` 非空时参与（见 §13）；响应附 `issues[].fieldValues`、`appliedCustomFilters`、`matchedFieldProjects[].schemaUrl`
- 列展示：前端渲染，无专门端点；可勾选字段为列表列（`localStorage` key `cf-cols:<projectId>`）
- 过滤条件可随保存视图快照（`IssueView.query` 内 `fieldValues` 对象），点击回放

## 6. 问题（Issue）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/:projectId/issues` | 查询参数：`stateId` `assigneeId` `q` `archived` `orderBy`（`updatedAt`/`createdAt`）`orderDir` + 分页 `page`（1 起，缺省 1）/`pageSize`（10–500，缺省 50）+ `cf.<key>=<value>`；**缺省排序 `updatedAt` 倒序**，显式只支持 `updatedAt`/`createdAt` 两键（`archived` 参数把结果集过滤为单一归档态，不参与排序）；返回 `{ issues, total, page, pageSize }`；`issues[]` 含 `fieldValues` |
| POST | `/api/projects/:projectId/issues` | `{ title, description?, descriptionText?, stateId?, assigneeIds?, fieldValues? }`；序号在事务内自增；`stateId` 缺省取项目 `isDefault` 状态，显式传 `null` = 有意留「无状态」（与 updateIssue 的 `null`=disconnect 同语义），显式传入但不存在/跨项目 → 422（不静默落为无状态）；`fieldValues` §5.3 动态校验 |
| GET | `/api/projects/:projectId/issues/:number` | 详情（含状态/负责人/创建人/`fieldValues`） |
| PATCH | `/api/projects/:projectId/issues/:number` | 部分更新（含 `fieldValues` 部分写入）；服务端 diff 生成活动：`STATE_CHANGED` / `ASSIGNED` / `UNASSIGNED` / `UPDATED`（含 `custom:<key>`）/ `ARCHIVED` / `UNARCHIVED`；进入 COMPLETED 组自动打 `completedAt`，移出自动清空；自定义字段变更可触发字段级通知 |
| POST | `/api/projects/:pid/issues/batch` | 批量更新：200 + `{ updated[], failed[] }`，单条失败不影响他人 |
| GET | `/api/projects/:projectId/issues/:number/activities` | 活动流（倒序，缺省最近 100 条，支持与 timeline 同款复合游标 `before`/`beforeId`）；Agent 审计面使用，详情页对话面板走 timeline 合并流 |
| GET | `/api/projects/:projectId/issues/:number/timeline` | **统一时间线（合并流）**：评论+活动按 (createdAt, id) 元组序混排，**排除 `COMMENTED` 活动**（与评论本体重复，只保留评论卡片与其余活动——Agent 按「评论+活动混排」口径预期时须注意此去重）；复合游标 `before`/`beforeId`，缺省最近 50 条 + `hasMore` + `total` |
| DELETE | `/api/projects/:projectId/issues/:number` | 删除（项目 ADMIN ∨ 工作区负责人 OWNER，即 `requireProjectAdmin`）。评论/活动/通知随 FK 级联；附件行 + 文件一并清理（文件 IO 在事务外，失败不阻断） |

`description` 为 Tiptap 文档（JSON）：服务端派生 `descriptionText` 纯文本（提及渲染为 `@名字`）用于搜索与 IM 摘要；直传 `descriptionText` 仍兼容。

## 7. 评论

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/:pid/issues/:number/comments` | 最近 50 条（旧→新），返回 `{ comments, hasMore, total }`；`author` 画像含 `origin`（POST 评论响应与时间线同口径）；`?before=<createdAt>&beforeId=<id>` 复合游标加载更早 |
| POST | `/api/projects/:pid/issues/:number/comments` | `{ body: TiptapDoc }`；服务端派生 `bodyText` 并写 `COMMENTED` 活动 |

评论支持 `@提及`（mention 节点，attrs: `{id, label}`）；通知引擎解析提及并推送。

## 8. 附件

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/projects/:pid/issues/:number/attachments` | 列表 |
| POST | `/api/projects/:pid/issues/:number/attachments` | `multipart/form-data`，字段 `file`；默认上限 10MB（`MAX_UPLOAD_MB`） |
| GET | `/api/attachments/:attachmentId` | 附件下载（**全量缓冲返回，非流式**——有 `MAX_UPLOAD_MB` 上限兜底，转换为大文件流式响应时需同步重构），需登录 + 归属链可见 |
| DELETE | `/api/attachments/:attachmentId` | 删除记录与文件 |

存储层为 `apps/web/src/server/storage.ts` 模块（当前本地磁盘实现，换 S3 只改该模块）；描述中粘贴/拖入图片自动上传并插入为附件引用。

## 9. 语义要点（面向 Agent / 通知）

1. **Issue 编号 per-project 唯一**，与 `projectId` 组成复合唯一键，展示为 `PROJ-123`
2. **Activity 是唯一事实源**：所有变更先 diff 成 `activities` 行再落库，通知与 Agent 审计都从这里派生
3. **State 三档结局分组**（ACTIVE/COMPLETED/CANCELLED）：COMPLETED 驱动 `completedAt`，CANCELLED 与 COMPLETED 共同决定「待我处理」排除与修复统计口径；阶段词汇由项目级状态名表达
4. `description`（Tiptap JSON）为富文本源，`descriptionText` 为派生纯文本搜索列

## 10. 分页与排序约定

- **表格类列表**（issue 列表）用**页码式**：`page`（1 起）/ `pageSize`（10–500，缺省 50），返回带 `total`；排序服务端化（`orderBy`/`orderDir` 进 URL，可选 `updatedAt`/`createdAt`，缺省 `updatedAt` 倒序——与 §1 列表参数口径一致）
- **时间线**（评论/通知/工作台）用**复合游标**：`?before=<ISO 时间>&beforeId=<id>`，排序 `(时间列 desc, id desc)`——同一事务多行时间戳相同（Postgres `now()` 事务稳定），仅凭时间游标会漏行，`id` 决胜才不重不漏
- **看板不页码化**：单次拉最新 500 条（`pageSize=500`），超限响应带 `total`，前端提示用过滤器缩小范围
- 不做静默截断：要么可翻页拉全（页码/游标），要么显式给出上限——看板以 `total` 提示，`/api/search` 固定上限 issue 20 条、项目 5 条（见 §13 表）

## 11. 个人工作台

> 工作台页面路由为 `/me`（账号壳首页）；API 与路由名无关。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/workbench?tab=assigned\|created&ws=<slug>` | 跨项目聚合，返回 `{ issues, stats: { assigned, created }, hasMore, nextCursor }`；`?before=&beforeId=` 复合游标；`&ws=` 可选收窄单一工作区（非成员/不存在 → 空结果，不泄露存在性）；待我处理 = 未完成（按状态分组）；`tab=mentioned` 返回 422（提及由「通知」tab 的类型筛选承载）；全链路私有项目可见性过滤；stats 徽标为对应作用域全量 count |

私有项目指派护栏：issue 创建/更新时，被指派人必须可见该项目（ProjectMember ∪ 工作区 OWNER），否则 422。

## 12. 账号与管理台

管理台（**需超级管理员**；治理与业务两平面正交，见 [04-workspace-design.md](04-workspace-design.md) §2）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/users` | 用户列表（含工作区角色/待改密/停用态/建号来源 `origin`） |
| POST | `/api/admin/users` | 建号（初始密码 + 强制改密 + 工作区角色；origin=EMAIL） |
| PATCH | `/api/admin/users/:id` | 姓名/**邮箱**/停用启用/授撤管理员；邮箱 trim+小写归一、insensitive 查重 422、**有密码账号不可清空**（422）；IM 建号补写 email 即开通密码通道（见 [03-auth.md](03-auth.md) §6）；护栏：**最后一个活跃超级管理员**（422） |
| POST | `/api/admin/users/:id/reset-password` | 重置（强制改密 + 全会话下线）；**无邮箱账号（IM 建号）422 拒绝**——密码登录按 email 定位，重置的密码无法兑现 |
| POST | `/api/admin/users/:id/roles` | 工作区角色设置/移除（role=null 移除）；护栏：**最后一个 OWNER** |
| GET | `/api/admin/workspaces` | 工作区列表（角色分配用） |
| POST | `/api/admin/workspaces` | 建工作区 `{ name, slug }` |
| PATCH | `/api/admin/workspaces/:wsId` | 重命名工作区（**slug 不动**，避免 `/w/:slug` 深链失效） |
| GET | `/api/admin/workspaces/:wsId/members` | 成员与可添加候选（工作区方向管理视图；画像含 `origin`；写操作同走 roles） |

## 13. API 令牌与全局搜索

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/api-tokens` | 我的令牌列表（永不返回明文）；**会话专用，Bearer 403** |
| POST | `/api/api-tokens` | `{ name, scopes[], expiresInDays? }` → 201，`token` **仅此一次返回**；`name` 必填（422） |
| PATCH | `/api/api-tokens/:tokenId` | 重命名自己的令牌（scope/有效期签发后不可改） |
| DELETE | `/api/api-tokens/:tokenId` | 撤销自己的令牌 |
| GET | `/api/search?q=` | 跨工作区全局搜索 issue 标题/描述与**项目名**（支持 `cf.<key>=<value>`，见 §5.4），结果带深链 `url`（issue → 详情页、项目 → 项目页）；**固定上限 issue 20 条**（`updatedAt` 倒序）**/ 项目 5 条**（`createdAt` 倒序），均无相关度排序、无分页——上限即截断口径（见 §10）；项目分组仅在 `q` 非空时参与（纯字段检索时为空数组） |

**Bearer 规则**（完整版见 [AGENTS.md](../AGENTS.md)）：权限 = scope ∩ 所属用户角色；scope = 资源:读写（路径最后一个资源段 + 方法推导，子资源随母资源 scope），`*` 全部；未知资源默认拒绝（唯一豁免：`/api/meta` 版本协商，任何有效令牌可读）；频控 120 次/分/令牌（429 带 `Retry-After`）；带过旧 `X-Client: solo-issue-mcp/<version>` 头的请求全程 `426`。scope 白名单单源至 `apps/web/src/lib/scopes.ts`（`API_SCOPES`），服务端 `token.ts` 与前端 `validations.ts` 共用。契约版本的定级与升位规则单源于 [11-mcp-adapter.md](11-mcp-adapter.md) §5。

## 14. 个人通知（会话专用）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/notifications` | 个人站内通知流（复合游标；流内含 MENTIONED 等类型，类型筛选由工作台前端承载，无服务端筛选参数） |
| POST | `/api/notifications/read` | 标记已读 |
| GET/PUT | `/api/notifications/preferences` | 通知偏好（类型×渠道矩阵，JSONB） |

以上三组端点均会话专用，不支持 Bearer。

## 15. 补充端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查（含数据库连通性；挂在部署 basePath 之下，见 `apps/web/src/lib/base-path.ts`） |
| GET | `/api/meta` | 版本协商（[11-mcp-adapter.md](11-mcp-adapter.md) §5）：应用 `version` + 契约版本 `apiContractVersion` + mcp 放行下限 `minMcpVersion`；Bearer/会话双通道，Bearer 侧豁免资源 scope |
| GET | `/api/mock/messages` | 模拟收件箱（仅 `ALLOW_IM_MOCK`；Bearer 禁区）。收件箱消息由 mock 通道服务端直写 DB，无 POST 入口 |
| POST | `/api/locale` | 语言切换：写 `NEXT_LOCALE` 偏好 cookie（非 httpOnly，`SameSite=Lax`），无副作用；入参 `{ locale }` 走 zod 枚举校验（`LOCALES`），非法值 422 |

## 16. 预留

- 评论编辑/删除 API — 后续补齐
