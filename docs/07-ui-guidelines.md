# UI 组件规范（shadcn/ui）

> 本文是全站 UI 的**唯一事实源**：设计令牌、组件用法、表单/弹框/表格/设置区块范式与多壳布局纪律。新代码一律遵守，防止回退到手写样式与弹层的双体系老路。

## 1. 设计令牌（最重要的一条）

**应用外观层一律使用语义令牌，禁止裸用调色板类。**

```tsx
// ✅ 正确
className="text-muted-foreground border-border bg-card hover:text-primary"
// ❌ 禁止（代码评审直接打回）
className="text-slate-500 border-slate-200 bg-white hover:text-teal-600"
```

| 令牌 | 用途 |
|---|---|
| `bg-background` / `text-foreground` | 页面底/主文字 |
| `bg-card` / `bg-popover` | 卡片、浮层容器 |
| `text-muted-foreground` | 次要文字（说明、占位、时间戳） |
| `bg-muted` / `bg-accent` | 中性区块、hover 背景 |
| `text-primary` / `bg-primary` / `ring-primary/40` | 品牌色交互 |
| `text-destructive` | 错误、危险操作 |
| `border-border` / `border-input` | 边框、输入边框 |

**两个白名单例外**（不属于"外观"，均有纪律约束）：
1. **领域语义色**：优先级徽章（红/橙/琥珀=紧迫度）、状态/标签颜色（DB 里存的十六进制）——是数据，不是主题；**前端代码不得写死任何裸 amber/emerald**，警示/成功一律走 §1.1 状态色令牌
2. **品牌色**：企微绿、模拟环境标识——改走状态色令牌的对应档（见 §1.1），不再引用裸调色板

### 1.1 状态色令牌

| 令牌 | 值（light） | 用途 |
|---|---|---|
| `bg-success` / `text-success-foreground` | emerald-600 系 | 成功反馈、企微品牌绿（实底） |
| `bg-success-subtle` / `text-success-text` | emerald-100 / emerald-700 | 成功徽章、品牌标识（淡底） |
| `bg-warning` / `text-warning-foreground` | amber-600 系 | 强警示（实底，慎用） |
| `bg-warning-subtle` / `text-warning-text` | amber-100 / amber-800 | 警示徽章、模拟环境标识（淡底） |

暗色值在 `.dark` 块同步维护。DB 存储的领域色（优先级/标签）**不走**此令牌（是数据不是主题）。

### 1.2 光标

**所有可交互元素一律 `cursor: pointer`**（disabled 时 `not-allowed`）。由 globals.css 全局规则统一提供，覆盖 `button` / `[role="button"]` / `[role="menuitem"]` / `[role="option"]` / `[role="tab"]` / `[data-interactive]` / `summary`，**禁止**在组件里手写 `cursor-pointer` 散类（会形成“同一页面三种光标”的双轨）。

- 非 role 元素的整行/整卡点击区（如工作台表格行）：加 `data-interactive`，不写死 cursor 类
- 拖拽点位（看板卡片）：`cursor-grab`，按压时 `active:cursor-grabbing`
- 例外白名单：文本域/编辑器内容区（保持 `cursor: text`）

### 1.3 圆角三档

| 档 | 类 | 用途 |
|---|---|---|
| 控件档 | `rounded-md`（= `--radius` 6px） | 按钮、输入框、下拉、Badge 内的小元素 |
| 卡片档 | `rounded-xl`（= `--radius` + 4px = 10px） | 卡片、弹窗、面板 |
| 胶囊档 | `rounded-full` | 头像、胶囊徽章、开关 |

`rounded-sm/xs/none/裸 rounded` 禁止新增（上游 ui 组件内部默认不在此列）。`--radius-sm/md/lg/xl` 由 `--radius` 派生，改一处全局联动。当前 `--radius: 6px`；`rounded-lg` 属过渡档，业务层不许新增，存量清零。

### 1.4 字号层次

正文体系只允许四个刻度：`text-xs`(12) / `text-sm`(14) / `text-base`/`text-lg`(16/18) / `text-xl`(20)。**禁止 `text-[10px]`、`text-[11px]` 等非刻度字号**——密度页面（admin/account）靠 `text-muted-foreground` 拉层次，不靠 1px 碎字号。

### 1.5 动画基线

- **节奏**：交互微反馈（颜色/透明度）统一 **150ms ease-out**——由 globals.css base 层对 `a/button/[role=…]/[data-interactive]` 提供默认过渡，**裸 hover: 无渐变的散点不再逐个补类**；阴影过渡不在 base 默认内，需组件层显式 `transition-[color,box-shadow]`（按钮已自带）
- **浮层**：Dialog/Popover 淡入淡出 200ms；Sheet 抽屉开/关对称 300ms（tw-animate-css 承担）
- **禁止 `transition-all`**（会带布局/transform 副作用，且各处触发面不一）：按需写 `transition-colors` / `transition-[color,box-shadow]` / `transition-[transform,opacity,box-shadow]`（拖拽卡）
- 组件层 `transition-*` 工具类优先于 base 默认，需要位移/缩放动画才显式写
- 加载态统一 `animate-pulse`（Skeleton），反馈一律 sonner toast——不自造第二套动效语言

### 1.6 间距节奏

`space-y` 只允许 `1 / 4 / 6` 三档：组内 `space-y-1`、组间 `space-y-4`、区块间 `space-y-6`。淘汰 `0.5/1.5/2/3/5` 中间档（避免“组内和组间同挤 6px”的拥挤感）。

## 2. 组件使用规则

| 场景 | 用什么 | 不要 |
|---|---|---|
| 按钮 | `Button`（variant: default/outline/ghost/secondary；size: sm/default/icon） | 手写 `<button className="bg-teal-600…">` |
| 输入 | `Input` / `Textarea` | 手写 border/focus 类 |
| 弹窗 | `Dialog`（自动 focus trap、ESC、点外关闭、Portal） | 手写 fixed inset-0 遮罩 div |
| 浮层 | `Popover` / `Select`（单选下拉）/ `Command`（可搜索列表） | 手写绝对定位下拉 |
| 切换 | `Tabs` / `Switch` / `Checkbox` | 手写 pill 按钮组 |
| 列表 | `Table`（+ §9 统一外壳）/ `Card` / `Badge` / `Separator` | 手写 table 样式；多字段数据行用 ul/li 卡片凑合 |
| 破坏性操作 | `ConfirmDialog`（`destructive` 红色确认，描述点名目标名称） | 直接执行 / `window.confirm` |
| 图标 | `lucide-react`（`<Plus className="size-4" />`） | emoji（🔔＋✕）/ 手写 SVG |
| 加载态 | `Skeleton`（全量替换裸文本） | 裸"加载中…"文本（禁止新增） |
| 操作反馈 | `sonner`：变更成功 toast.success / 系统错误 toast.error；表单校验错误保持表单内联 | 各处自造"已保存 ✓"临时文字 |
| Issue 标识 | 项目内 `#N`；跨项目上下文 `SLUG-N`（如 DEMO-9，通知/搜索/工作台统一） | 三种格式混用 |
| 成员选择 | `MemberCombobox`（姓名+邮箱可搜）。布局语义走 `variant`：`field`=表单字段（h-9，chips 截 6)+"+N"；`staging`=暂存区（自动高、全量 chips）——**调用方不得 className 反杀高度/截断**（同类覆盖历史上先后制造过竞态/显示不全/撑破/顶出容器四类缺陷） | 只显示姓名的按钮组/checkbox 列表（重名不可辨） |
| 通知入口 | 个人工作台「通知」tab（类型筛选 chips + 行内偏好）+ 顶栏徽标舱（账号层常驻信号，点击回 /me） | 侧边栏/页内另建铃铛入口（防入口繁殖） |

**新组件的获取方式**：`pnpm dlx shadcn@latest add <name>`（拷贝进仓库的代码，属于你，可改）。`sonner`（toast）与 `command`（可搜索列表）已按需引入；`react-day-picker`（日历）等出现真实诉求再加，**禁止为了"以后可能用到"预先安装**——死依赖也是坑。

## 3. className 合并约定

所有可组合组件（含业务组件）接受 `className` 并用 `cn()` 合并：
```tsx
import { cn } from "@/lib/utils";
<div className={cn("rounded-lg p-3", active && "bg-primary/10", className)} />
```
`cn = clsx + tailwind-merge`：调用方传入的类**总是能覆盖**默认类，这是"可定制不撕裂"的关键。

## 4. Radix Select 空值坑

`<SelectItem value="">` 会直接抛错（Radix 限制）。约定哨兵值：
```tsx
const ALL = "__all__";
<Select value={filters.stateId ?? ALL} onValueChange={(v) => onFilter(v === ALL ? null : v)}>
```

## 5. 暗色模式

暗色模式经 `next-themes` 落地：全站唯一切换入口在顶栏账号弹层「外观」子菜单（§7），令牌的 `.dark` 块值在 globals.css 同步维护。**新代码不得硬编码任何只在浅色下成立的颜色**（见 §1）。

## 6. 表单范式决策（记录在案）

- 当前：受控 `useState`（表单都很简单：1-5 个字段）
- **触发点**：当出现 ≥8 字段或需异步校验的表单（如自定义字段与通知规则编辑器、AI Agent 配置）时，整体引入 `react-hook-form` + `zodResolver` + shadcn `Form`
- 禁止在个别表单提前引入 RHF 造成两种范式并存

### 6.1 必填校验双闸

- **客户端**：必填项为空时提交按钮置 `disabled`（必要时内联提示）；**禁止静默兜底默认值**（如空名称静默存成「未命名令牌」——曾造成同名令牌无法区分）
- **服务端**：zod schema 同样拦截（422），客户端校验只是体验层不是安全层
- 多选授权类（如令牌 scope）：选了「全部」时具体项置灰并提示「已选全部，具体选择将被忽略」——禁止两套选中态并存让用户误以为都没选

### 6.2 内部枚举值禁止裸奔到 UI

DB/协议里的内部标识（如 `"*"`、`issues:write`）展示时必须过一层 label 映射（中文标签）；映射缺失时回退原值但不得以裸值作为常态方案。

## 7. 带侧边栏页面的布局原则（四壳同构）

全站四个侧边栏外壳（业务 / 实例治理 / 个人偏好 / 账号 `me`），布局模式同构、**骨架单源**（`ShellScaffold`：三形态单源）——壳间语境差异大（业务导航 / 实例治理 / 全站个人偏好 / 跨工作区个人工作台），不再各写独有实现：

| 壳 | 语境 | 路由前缀 |
|---|---|---|
| `WorkspaceShell` | 业务导航（工作区/项目） | `/w/*` |
| `AdminShell` | 实例治理，不涉及业务数据 | `/admin/*` |
| `SettingsShell` | 全站个人偏好（非纯账号域） | `/settings/*` |
| `AccountShell` | 跨工作区个人工作台（`/me` 首页） | `/me` |

**外壳三形态单源**：桌面常驻侧栏（app-shell 式布局：顶栏 h-12 固定 + 侧栏钉满视口高、内容区内部滚动，长页面滚动时侧栏始终可达）/ 桌面折叠态（`w-[52px]` 图标列）/ 移动端 Sheet 抽屉（`<md`，hamburger 顶栏）——由 `ShellScaffold` 单一组件三形态共享，改一处三态同步。

**分区导航单源**：nav 数组（`ADMIN_NAV` / `SETTINGS_NAV`）驱动侧边栏导航，新增分区 = 数组加一行 + 建一个路由文件夹（layout 守卫自动覆盖）。不建空壳导航页（不预先挂占位分区）。

**内容区宽度（最容易违反的一条）**：内容容器**全宽铺满剩余宽度**——`px-8 py-6`，**禁止 `mx-auto max-w-*` 居中限宽**。目的：页面间切换时宽度不跳动；密度靠 `text-muted-foreground` 拉层次，不靠限宽凑阅读性。

**折叠持久化各壳独立**：`sidebar_collapsed`（业务）/ `admin_sidebar_collapsed`（治理）/ `settings_sidebar_collapsed`（偏好）/ `account_sidebar_collapsed`（账号壳）——不同语境互不同步。

**底部区纪律**：各壳侧栏底部**只渲染收起/展开切换**；头像即账号弹层、管理台入口（管理员）、退出登录、主题切换（「外观」子菜单）统一上移顶栏——**退出登录不进任何侧边栏**（防误点，唯一入口在顶栏头像弹层）；**主题切换全站唯一入口是顶栏账号弹层「外观」子菜单**，任何壳不再加 ThemeToggle/快捷主题按钮。

**收起/展开单独一行**：折叠切换按钮不与底部操作共用一个分区——放独立分区（自带 `border-t`，`py-2`），仅桌面常驻形态渲染（移动抽屉无折叠概念）。布局态操作与导航/业务操作分区隔离，避免视觉拥挤误触。

**路由变化自动收移动端抽屉**（点导航项后不残留遮罩）。

## 8. 零回退基线

全站外观层统一基于 shadcn/ui 组件 + 语义设计令牌（§1），**禁止重新引入**任何手写样式体系：手写按钮配色 / 手写遮罩弹层 / 原生 select / emoji 图标 / 裸加载文案。每轮 UI 改动以审计命令退出码 0（无违规明细）为验收标准之一——回退一处，"双体系并存"的老路就回来了。

```bash
bash apps/web/scripts/audit-ui.sh
```

审计共 **10 项**：裸调色板 / emoji 图标 / 仅 title 无 aria-label（跨行判定）/ 裸"加载中…"加载态 / 手写弹层遮罩 / 原生 select / 裸状态色 amber|emerald / 任意字面量字号 `text-[..]`（非刻度字号一律禁止）/ 圆角越三档 / space-y 越档。新增代码跑一下，应**全过 10/10**（分节头与「✓ 全部通过」汇总行属正常输出，违规才会计数）。

## 9. 弹框 / 表格 / 明文凭据范式

全站同构范式（同 §7「模式共享不共享代码」：同款组件出现 ≥3 次才抽公共壳，当前先类级对齐）：

### 9.1 创建/修改表单的入口形态

- 页头右侧放主操作按钮（`size="sm"` 主 variant + 图标）。入口形态二选一：轻量交互弹 Dialog；**需要深链/中途刷新恢复的长表单（如新建 Issue）走独立短路由页**（`/issues/new`，带面包屑返回），编辑态即详情页本身。两种形态下都**禁止页内内联展开长表单**
- **页头配方**：带侧栏壳的页面级标题区**只保留标题本身 + 右端主操作**，禁止标题下挂说明行/副文案——功能性前置告知归属操作位点：表单内联提示（如改密卡片的吊销告知）、成功后 toast、Dialog 描述。信息在使用时机出现，静态页头文案第二次朗读只会被略过。其余组件化为 `shell/PageHeader`（`title` + children 右端主操作；`titleExtra` 承载紧贴标题的复合位点如项目设置钮；行级差异走 `className`），新页头禁止手写 h1 + justify-between。同范式三条：① **字号单值**——页面级 h1 一律 `text-xl font-semibold tracking-tight`（"话题型/复述型"二分归属不清，单值判据才可维护）；② **区隔一律留白**（`mb-6` / 页头区自查询 `py`），禁止页头挂 `border-b` 分割线（表格/工具条的区块边界由 §9.2 外壳自身承担）；③ **h1 不配图标**（侧栏导航保留图标，页头不复述）
- 修改受限场景（如令牌 scope/有效期签发即定不可变）：弹框内描述文案说明哪些可改、哪些需作废重建，不要靠隐藏字段表达

### 9.2 表格三件套（组件级单源 `TableShell`）

外壳配方已抽为组件 `apps/web/src/components/ui/table-shell.tsx`，新表禁止自创外壳、禁止粘贴类名：

```tsx
<TableShell>
  <Table>
    <TableHeader className="text-xs text-muted-foreground">
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableHead className="px-4 py-2.5">…</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow className="border-b border-border/60 last:border-0 hover:bg-muted/40">
        <TableCell className="px-4 py-2.5">…</TableCell>
```

- 空态行用同文件的 `TableEmptyRow`（`colSpan` 必传，默认 `py-8 text-sm`，行距/字号差异走 `className` 覆盖）
- loading 骨架列宽因表而异，不收进 `TableShell`，调用方按列宽自写

- 多字段数据行（名称+元信息+操作）用 Table 拆列，不靠一行文本流拼 `·` 分隔符；操作列右对齐（`text-right`）
- 行内编辑/删除逐行放 ghost 变体图标/文字按钮；删除类按钮 `hover:text-destructive` 但确认必须走 `ConfirmDialog`（§2 破坏性操作）

### 9.3 一次性明文凭据（令牌/密码类）展示范式

- 创建成功后**停在同一 Dialog 内**展示明文 + 复制按钮，必须显式点「我已保存」式按钮关闭；未复制直接关闭时 toast 提醒
- 重新打开弹窗永远不携带上次明文（开弹窗即重置）；Dialog 描述里明说「关闭后无法再次查看」

### 9.4 弹框表单范式

**弹框的定位边界**：弹框只承载「创建/修改」短表单（标题 ≤8 字段量级）。**动态产出新实体的长列表管理不进弹窗**——固定高度弹窗内滚动 + 内嵌长表格会形成行内编辑与 Select 下拉的双重滚动反模式，一律升级为**页面级路由**（案例：项目设置 `/w/:ws/p/:slug/settings`，页头按钮 + Tabs + 表格三件套）。弹窗内只保留单条创建/编辑（§9.1 原则的表单侧延伸）。

**边界精确化**：上条禁的是「列表本身会**新增/产出实体**」的管理场景（状态/字段这类行内建改删）。**从存量中选择/绑定现有实体**（工作区成员管理：候选=已建好的活跃账号，只变更归属与角色，不产出新用户）不属此列，可在弹框内以表格承载。判据一句话：**看列表操作会不会造出新东西**——会造，升级页面；只从存量挑，弹框可行。弹框内表格走下方 §9.4b 去壳范式。

### 9.4b 弹框内表格范式（去壳表格）

弹框内出现列表/表格时，**禁止照抄 §9.2 三件套外壳**——三件套的 `rounded-xl border bg-card shadow-sm` 是为页面级内容块设计的（自己就是一张卡，靠页面留白托底）；而 `DialogContent` 本身已经是卡，嵌套会形成「框中框」（双圈边框 + 双层阴影 + 双套留白），违和根源即在于此。规则：

- **去外壳**：不套 `rounded-xl border bg-card shadow-sm`，边界与卡由 `DialogContent` 自身承担
- **表头去底色**：不复制 `bg-muted/50` 头条，表头靠 shadcn 表头自带的底部 border 分隔即可
- **正文行照旧**：`border-b border-border/60 last:border-0 hover:bg-muted/40` 三件套行配方不变（对齐/骨架屏/空态行照抄 §9.2）
- **宽度档**：去壳后无需为容纳外框撑宽，`sm:max-w-xl` 量级（四列内）；列更少可回到 `sm:max-w-md`
- 案例原型：管理台工作区表「成员管理」弹框（`MemberManageDialog`——成员/状态/角色/操作四列）

**弹框内表单排版铁律**（新建/编辑字段双弹框同款，禁止回退）：

- **每行一个表单项**：Label（`ui/label` 组件）在控件上方，`grid gap-1` 包裹；禁止 `grid-cols-2` 两列栅格混排（显示名/key 并排曾造成视觉基线错位，已废除）
- **行间距只用 `space-y-4`**（组间），组内 `gap-1` / `space-y-1`
- **开关项 = 纯行式**：`SwitchRow` 模式——左侧 `<Label>`（可带 `text-xs text-muted-foreground` 副文案）、右侧 `Switch`，**不加边框卡片**；页面级设置卡片行是另一语境走 §10，不混用
- **分块配置不加边框**：类型专属配置（选项、通知规则）与普通表单行视觉一致（Label 在上 + 说明行文 + 控件），禁止 `rounded-xl border p-4` 套块制造「弹中弹」
- **Footer 三件套**：`DialogFooter` + 取消（ghost）+ 确认（primary，`type="submit"` + `form` id 关联外层 form）；必填校验双闸（§6.1）——空值 disabled / 服务端 zod
- **文案**：开关 Label 用可读问句/陈述（如「是否必须填写」「允许多选」），说明性信息进 `DialogDescription` 或 hint，不塞进按钮

## 10. 设置区块卡片范式

设置域页面（项目设置 `/w/:ws/p/:slug/settings`、账号 `/settings/account` 等）的区块外壳统一为**头部条卡片**，禁再出现「裸 section + 裸 h2 + Separator 拼页」的旧结构。

### 10.1 头部条卡片（设置区块单源）

```tsx
<section className="rounded-xl border border-border bg-card shadow-sm">
  <div className="flex items-center justify-between rounded-t-xl bg-muted/50 px-4 py-3">
    <div>
      <p className="text-sm font-medium">区块名</p>
      <p className="text-xs text-muted-foreground">副文案</p>
    </div>
    {/* 右端 = 操作位点：Segmented / Switch / 按钮；无操作则留空 */}
  </div>
  <div className="p-4">…内容（可无）</div>
</section>
```

- 头部条复用 §9.2 表头行 `bg-muted/50` 的既有语义（区块 = 一张小表，头部是区块名，等同表头）；整卡配方与表格三件套外壳一致（`bg-card shadow-sm`）——整卡亮底与亮头部互斥，亮的方案只能是整卡 `bg-card` + 头部条仍 `bg-muted/50`，即本条；设置块不与承载数据的表格争视觉权重
- **副文案固定描述选项/操作本身**，不是「选了什么之后对当前值的复述」——复述型文案第二次朗读会被略过（与 §9.1 页头配方同理）
- **危险操作头部条变体**：`bg-destructive/10` + 标题 `text-destructive`——危险度由颜色表达而非页面位置（归档/删除分居两张卡，安全出口不染红）
- 卡片可只有头部条（开关类、纯操作类），可追加内容区（表单、说明）
- 账号页同构：独立 h2 + `Separator` 分节结构已淘汰

### 10.2 二选一开关 = Segmented（复用 Tabs boxed 形态）

互斥二值选择（公开/私有等）不用两个独立 Switch、不用 Select：

```tsx
<Tabs value={isPrivate ? "private" : "public"} onValueChange={…}>
  <TabsList className="grid w-full grid-cols-2">
    <TabsTrigger value="public">公开项目</TabsTrigger>
    <TabsTrigger value="private">私有项目</TabsTrigger>
  </TabsList>
</Tabs>
```

- 行内右对齐作为头部条右端的操作位点；两个独立 Switch 的旧方案已废（语义是两个布尔而非一个单选，且滋生「关闭已选项」的无效状态）
- 改动契约时注意：值切换后按值条件渲染的说明块会变得多余（选项语义已在副文案中说清），只保留有操作价值的结果（如成员表格）

### 10.3 强关联的视觉表达：同卡从属 + 即时展开

「A 的取值决定 B 是否存在」时（项目类型 → 成员管理），B 是 A 的**展开内容**而非平级区块：

- 同一张头部条卡片：A 在头部行，B 在卡身
- 条件渲染容器加 `animate-in fade-in slide-in-from-top-2 duration-200`——切换到触发值时内容当场滑入，即时反馈本身就是最强的因果信号（tw-animate-css 既有基线，不自造动效）

### 10.4 批量添加成员（§9.1/9.4 的应用范式）

- 「添加成员」= 页头按钮 + Dialog；Dialog 内 `MemberCombobox` 多选（一次多个账号），角色默认 `MEMBER`，提交后逐个 POST（API 无需批量端点）
- 角色分配在表格行内 Select 事后调整——弹框只承创建，不混角色配置
- 弹框内多选成员一律走 `MemberCombobox` 的 `staging` variant（自适应高度、全量 chips，见 §2 成员选择行）——**禁止**再用 `className` 覆盖 `h-9` 反杀高度（旧配方已废，正是竞态/显示不全/撑破/顶出容器四类缺陷的根源）
- 弹框表单控件竖直堆叠（`grid gap-3` 单列），禁多列混排（§9.4 铁律同源）
