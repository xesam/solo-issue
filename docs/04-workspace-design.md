# 工作区（Workspace）· 设计逻辑

> 依据：`apps/web/prisma/schema.prisma` · `apps/web/src/server/auth/access.ts` · `apps/web/src/server/auth/project-visibility.ts` · 总体架构见 [01-architecture.md](01-architecture.md)
> 一句话定位：**工作区不是「功能容器」，而是系统的「权限原语」——一切业务权限的单一事实来源**。

## 1. 模型定位：一张刻意做「薄」的表

```prisma
model Workspace {
  id, slug, name, icon, createdAt   // 仅此而已
  members  WorkspaceMember[]        // 职责一：装成员关系
  projects Project[]                // 职责二：装项目
}
```

对比参考项目 Plane：工作区下没有 team、没有设置项、没有自定义字段。所有功能重量（State/View/Issue/字段管理）全部压在 **Project** 层，工作区只保留两个职责。

为什么敢这么薄——团队场景的组织架构活在企微/钉钉 IM 里（使用形态见 [01-architecture.md](01-architecture.md) §1），系统不复制组织结构，只需一张薄成员表回答一个问题：**「这个人能不能看这摊事」**。

推论：工作区不冗余进 Activity（聚合单位是 project，`Activity.projectId` 才有反范式冗余）——它是纯边界，不承载内容。

## 2. 权限边界：业务权限单一来源（超管正交）

核心决策——**超级管理员与业务权限正交**：

```text
治理面：User.isAdmin        → 只解锁 /admin 管理台，不自动属于任何工作区，不穿透业务数据
业务面：WorkspaceMember.role → OWNER/MEMBER/GUEST，一切业务权限从这查
```

由此得到最干净的推论：**可见性 = 成员关系**。`access.ts` 的守卫链全部以此为轴：

| 守卫 | 语义 |
|---|---|
| `requireWorkspace` | 任意成员（含 GUEST）可读；非成员 404（防枚举） |
| `requireWorkspaceAdmin` | 工作区负责人（OWNER），建项目等工作区级操作 |
| `requireProject` | 先查工作区成员，再叠加私有项目可见性判定 |
| `requireProjectWrite` | MEMBER 及以上；GUEST 不论在哪一层（工作区/项目成员）一律只读（403 `Guests have read-only access`） |
| `requireProjectAdmin` | 项目设置/字段与状态定义/成员管理：项目负责人 ∨ 工作区负责人；GUEST 先过只读不变量 |

佐证这层逻辑的 UI 决策：`/admin` **不进 WorkspaceShell**——硬套业务壳会出现 isAdmin 但 GUEST 的权限矛盾与虚假工作区语境。工作区语境 = 权限语境，两者必须对齐。

## 3. 权限瀑布：工作区角色是上游，项目角色按需激活

私有项目可见性是一条精确公式（`project-visibility.ts`）：

```text
可见 = 公开项目 ∪（私有 ∧（ProjectMember ∨ 工作区负责人 OWNER））
写   = 可见 ∧ 非访客（工作区 GUEST、或项目级 GUEST 成员均只读）
```

关键设计：**`ProjectMember` 表平时闲置，私有项目（`Project.isPrivate`）与项目定义管理（字段/状态的 `requireProjectAdmin`）才激活**。项目角色不是独立权限体系，而是工作区角色之上的「收紧阀门」——工作区角色决定能不能进门，项目角色只在门内再设一道闸。这避免了「两级角色 + 细粒度权限」复杂度失控（产品边界明确不做行级权限，见 [01-architecture.md](01-architecture.md) §2.2）。

公式复用的三处调用形态：

- `listProjects`：工作区项目列表（已知成员角色；可见性过滤内联在其 where 构造里，无独立导出函数）
- `resolveProjectAccess`：单项目访问判定（API/页面共用）
- `crossWorkspaceProjectVisibility`：跨工作区场景（见 §6）

另一处体现：指派护栏（`services/issue.ts`）——被指派人必须「能看到该项目」，本质是拿**被指派人的工作区角色**去跑同一条公式，防「幽灵任务」（422）。

## 4. 命名空间：URL 根与唯一性的顶层

```text
/w/[wsSlug]/p/[projSlug]/issues/[number]
```

- `Workspace.slug` 全局唯一，是 URL 第一段；`Project @@unique([workspaceId, slug])`——项目 slug 只在**工作区内**唯一
- `adminRenameWorkspace` 只改 name，**slug 永不改动**——避免所有 `/w/:slug` 深链失效（slug 是稳定标识，name 是展示名）
- slug 校验：3-32 位小写字母/数字/连字符（`admin-user.ts` WS_SLUG_RE，另有 `validations.ts` slugSchema 供项目用）
- 命名空间逐层下放：工作区 → 项目（slug/issueSeq）→ 状态/issue 序号，每层只管直接下层

## 5. 治理生命周期：创建权在治理面，成员进出全在管理台

- **只有超级管理员能建/重命名工作区**（`POST /api/admin/workspaces`），且新工作区默认无人、需在管理台加入成员——工作区不是自助组织，是治理动作
- 成员进出的三条路径：
  1. 管理台建号时直接带工作区角色（origin=EMAIL）
  2. 管理台分配：**用户表方向**（「加入工作区」，`POST /api/admin/users/:id/roles`，role=null 移除）与**工作区表方向**（「成员管理」弹框，`GET /api/admin/workspaces/:wsId/members` 供成员与候选视图，写操作同走 roles）对等
  3. IM 通道首次登录自动入第一个工作区（MEMBER，`auth-im.ts`）
- **护栏以工作区为单位**：最后一个活跃 OWNER 不可移除（`assertNotLastWorkspaceOwner`）——边界永远有责任人
- 工作区自身无自治理 API（工作区负责人不能拉人/踢人）——治理集中而非分散，与「内部工具、组织架构在 IM」定位一致
- Seed 闭环：第一个管理员 + 工作区 `main` + OWNER

## 6. 跨工作区场景：边界圈范围，公式做过滤

一人可在多个工作区（`WorkspaceMember` 复合主键）。三处跨边界场景全部遵循同一条公共形态：先取 `wsMemberRoles`（我所在的边界集合），把私有项目可见性公式（`crossWorkspaceProjectVisibility`）AND 进去——**边界负责圈定范围，公式负责范围内过滤**，两个关注点分离。

### 6.1 个人工作台 `/me`（账号壳）

- 跨工作区聚合「待我处理/我创建」+ 通知 tab（提及并入通知类型筛选，客户端过滤在 `components/workbench/Workbench.tsx`，数据走 `/api/notifications`）；无任何成员关系 → 返回空（不抛错，登录引导层处理）
- **单工作区收窄态**：`/me?ws=<slug>` 单工作区任务汇总——账号壳「工作区」行的下钻落点（主行下钻进工作区层，行尾收件匣图标进入收窄态）；Workbench 带 `&ws=` 作用域声明与退回全局钮。页面先经本人工作区名单过滤：非成员/不存在的 slug 被忽略、回退全局视图（不泄露存在性）；服务层 API 直调时对应空集
- **Workbench 列表层**：自适应分组（条目跨 ≥2 工作区才分节，段头可点击直达；单工作区保持混排）+ 恒定归属一级信号（每条携带工作区/项目/编号面包屑，点击前可见落点）

### 6.2 全局搜索

`GET /api/search` 跨工作区检索 issue 标题/描述，同一可见性公式全链路过滤（含私有项目）；结果带可直接给用户的深链 `url`。

### 6.3 工作区切换器（`WorkspaceSwitcher`）

切换固定落到目标工作区首页——**项目/issue 在工作区间不存在对应关系**，保留子路径只会 404。工作区间是真正不连通的孤岛，无跨工作区实体映射；多工作区下拉切换、单工作区只读展示（不装下拉交互成本）。

## 7. 层级信息架构：三层模型与四壳同构

三层模型：**账号（me）→ 工作区 → 项目**，各层有独立容器，账号层为导航树根节点。

### 7.1 账号壳 `/me`（AccountShell，基于 ShellScaffold）

登录落地页。身份服务（头像/外观/退出登录）在顶栏账号弹层，页内不再重复展示。组成 = 计数卡阵列（待我处理/我创建/未读，计数即导航：`/me?tab=<key>` 深达 Workbench 对应 tab）→ Workbench（三 tab 原样嵌入）。侧栏 = 工作台项（/me 本页项，本层身份承载者）+「工作区」下钻通道分组段（joinedAt 序、内部滚动、跳级禁令：不跳级预览项目内容）。

### 7.2 顶栏（TopBar，全局固定、跨壳共享）

- 组成：Logo 区 / 全局搜索 / 徽标舱（账号层常驻信号，所有页面可见，点击回 /me）/ 头像 + Admin 入口（同级）
- 头像弹层内含「外观」主题子菜单（全站唯一入口）与「退出登录」（唯一入口，防误点）
- 顶栏与侧栏的头条分工：**顶栏管跨层不变的服务，侧栏管本层身份与词汇**

### 7.3 工作区壳

- 壳布局为 app-shell 式（顶栏 h-12 + 主体内部滚，不超出视口）
- 工作区壳侧栏不设「个人工作台」入口（职能由徽标舱承担）；`/w/:slug/mine` 路由不存在——工作台归属账号层

### 7.4 四壳同构

| 壳 | 语境 | 路由前缀 |
|---|---|---|
| `WorkspaceShell` | 业务导航（工作区/项目） | `/w/*` |
| `AdminShell` | 实例治理，不涉及业务数据 | `/admin/*` |
| `SettingsShell` | 全站个人偏好（非纯账号域） | `/settings/*` |
| `AccountShell`（/me） | 账号层 | `/me` |

四壳同构（基于 `ShellScaffold`，三形态单源：桌面常驻 / 桌面折叠 `w-[52px]` / 移动端 Sheet 抽屉），折叠态键分域（`sidebar_collapsed` / `admin_sidebar_collapsed` / `settings_sidebar_collapsed` / `account_sidebar_collapsed`），壳语境互不串扰。布局细节纪律见 [07-ui-guidelines.md](07-ui-guidelines.md) §7。

## 8. 安全语义：404 不泄露，403 拒绝

| 场景 | 行为 | 理由 |
|---|---|---|
| 页面层访问无权限的工作区/私有项目 | `notFound()`（`server/auth/pages.ts`） | 不可见 = 404（不泄露项目存在） |
| API 层非工作区成员 | 404（`requireWorkspace` 同口径） | 防枚举：与「不存在」不可区分 |
| 可见但角色不足的写操作 | 403 | 已登录身份的权限不足 |

对「存在性」的信息控制被纳入边界设计本身。

## 9. 能力矩阵

> 全站权限口径的**单一事实源**；[08-deployment.md](08-deployment.md) 等其他文档只链接不复制。

**业务面**（判权依据 = `WorkspaceMember.role`；私有项目叠加 `ProjectMember`）：

| 操作 | GUEST | MEMBER | OWNER（负责人） |
|---|---|---|---|
| 读（项目/issue/成员/状态/附件） | ✅ | ✅ | ✅（私有项目需可见） |
| 写 issue/评论/@提及/上传附件/字段值 | ❌ 只读（403 `Guests have read-only access`） | ✅ | ✅ |
| 建项目 | ❌ | ❌ | ✅ |
| 项目设置/归档 | ❌ | ❌ | ✅（ws OWNER 或被授予 ProjectRole.ADMIN 的成员） |
| 删除项目 | ❌ | ❌ | ✅（ws OWNER 或 ProjectRole.ADMIN；另需 0 issue 护栏 + 输入 slug 确认） |
| 字段/状态定义管理 | ❌ | ❌ | ✅（或被授予 ProjectRole.ADMIN 的成员） |

**治理面**（判权依据 = `User.isAdmin`，不穿透业务）：

| 操作 | 权限 |
|---|---|
| 建号/停用/重置密码/授撤超管 | isAdmin（护栏：最后一个活跃管理员） |
| 建/重命名工作区 | isAdmin（slug 永不改） |
| 工作区角色分配/移除 | isAdmin（护栏：该工作区最后一个活跃 OWNER） |

**Agent 面**（根目录 [AGENTS.md](../AGENTS.md)）：`Bearer itr_*` 权限 = **scope ∩ 令牌所属用户角色**——Agent 通过所属用户的成员关系看世界，无越权能力。

## 10. 设计原则总结（含与 Plane 的裁剪对照）

| 层面 | 工作区扮演的角色 |
|---|---|
| 组织 | 最小成员表（组织架构外包给 IM） |
| 权限 | 业务权限单一来源；项目角色只是其上的例外闸门 |
| 命名 | URL 根与命名空间顶层，slug 永不改变 |
| 治理 | 创建/护栏的责任单位，与超级管理员正交 |
| 隔离 | 工作区间无实体映射，跨域仅只读聚合 |

元设计：**「重功能」与「轻边界」分开压层**——工作区薄到几个字段却撑起整套权限模型；会演化变复杂的东西（状态机/视图/自定义字段）全部推到项目层。加上「私有项目/定义管理才激活 ProjectMember」的按需设计，两级角色模型在保持极简的同时留出向细粒度演化的缝。

对 Plane 的裁剪：保留 workspace/workspace-member/project 骨架，砍掉 team 层、工作区设置、细粒度权限——验证过的思想借鉴，复杂度不照搬（借鉴红线见 [01-architecture.md](01-architecture.md) §5.3）。
