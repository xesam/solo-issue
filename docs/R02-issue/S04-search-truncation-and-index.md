# S04 全局搜索静默截断，标题与描述无检索索引

> 状态：待处理（不阻塞 0.0.1 内测）｜严重度：低｜记录日期：2026-10-23
> 2026-10-23 进展：§2.2 注释失实已修正；docs/06 §10/§13 与 `AGENTS.md` §2 已将「固定上限 20 条、`updatedAt` 倒序、无分页」写为显式口径。§3.1 的 `hasMore` 响应扩展（含契约定级与 mcp 工具描述同步）仍待实施，§2.3 索引维持原状。

## 1. 现象

`GET /api/search`（`apps/web/src/app/api/search/route.ts`）：

- 标题和描述用 `contains` + `mode: "insensitive"` 匹配（`:103-104`），对应 SQL 的 `ILIKE '%关键词%'`；
- 按 `updatedAt` 倒序取前 20 条（`:112-113`），响应里没有总数，也没有"是否还有更多"的标记。

## 2. 问题

### 2.1 违反"不做静默截断"约定

`docs/06-api-contract.md` §10 规定"要么可翻页拉全，要么显式提示截断"。搜索结果超过 20 条时，调用方（包括 Agent 和 MCP 工具）无法得知还有更多结果。`AGENTS.md` §2 只写了"命中上限 20 条"。

### 2.2 代码注释与实际行为不符

`route.ts:113` 的注释写"取最相关的头部集合"，但实际排序是 `updatedAt` 倒序，没有相关度排序。

### 2.3 无检索索引

迁移里只有 `fieldValues` 整列 GIN 索引（由 schema `@@index([fieldValues], type: Gin)` 表达、随基线迁移生成），`issues.title` 和 `issues.descriptionText` 没有索引。`ILIKE '%…%'` 用不上 B-tree 索引，每次搜索都会对可见项目内的 issue 做顺序扫描。项目内列表的 `q` 参数（`apps/web/src/server/services/issue.ts:121-122`）也一样。内测数据量下没有影响，数据量增长后再处理。

## 3. 处理方案

### 3.1 第一步：显式标记截断（推荐先做）

- 查询多取 1 条（`take: 21`），只返回前 20 条，响应增加 `hasMore: boolean`，命名与工作台、时间线接口一致；
- 修正 `route.ts:113` 的注释；
- 同步 `docs/06-api-contract.md` 的搜索路由说明、`AGENTS.md` §2 `search_everything`、`packages/mcp` 的工具描述；这是响应新增字段，按 `docs/11-mcp-adapter.md` §5 定级。

### 3.2 第二步：引入 pg_trgm 索引（数据量增长后）

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "issues_title_trgm" ON "issues" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "issues_descriptionText_trgm" ON "issues" USING GIN ("descriptionText" gin_trgm_ops);
```

- `gin_trgm_ops` 需显式指定操作符类，Prisma schema 的 `type: Gin` 只用默认操作符类、无法表达此类索引，仍需单独维护手工 SQL 迁移；
- `CREATE EXTENSION` 需要数据库超级用户或相应权限：Compose 自带的数据库满足；裸机使用独立实例时，需要 DBA 预先安装扩展，`docs/08-deployment.md` 要写明；
- trigram 索引只对 3 个字符及以上的关键词生效，中文 1 到 2 个字的检索仍会顺序扫描，需要实测后决定是否接受。

## 4. 验收标准

- 集成测试：构造 21 条命中 → 返回 20 条且 `hasMore=true`；20 条命中 → `hasMore=false`；
- `apps/web/scripts/verify-mcp.ts` 契约矩阵全绿（契约变更合并前的要求，见 `AGENTS.md` §5）；
- 第二步落地时：用 `EXPLAIN` 确认 3 个字符及以上的关键词走 trigram 索引。
