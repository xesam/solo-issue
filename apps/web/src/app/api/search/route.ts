import { ok, HttpError } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireApiUser } from "@/server/auth/access";
import { searchEverywhere } from "@/server/services/search";

export const dynamic = "force-dynamic";

// 从查询串收集 cf.<key>=<value>（跨项目自定义字段过滤）
function collectCustomFilters(sp: URLSearchParams) {
  const out: Record<string, string> = {};
  for (const [k, v] of sp.entries()) {
    if (k.startsWith("cf.") && v !== "") {
      const key = k.slice(3);
      if (key) out[key] = v;
    }
  }
  return out;
}

// GET /api/search?q=关键词[&cf.<key>=<value>] —— 跨工作区全局搜索（issue 标题/描述 + 项目名）
// Agent 场景主入口：检索 issue 与项目并返回深链所需全部上下文；检索逻辑单源在
// services/search.ts（searchEverywhere），本文件只做协议层参数收集与校验
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    const sp = new URL(req.url).searchParams;
    const q = (sp.get("q") ?? "").trim();
    const customFilters = collectCustomFilters(sp);
    // 关键策略：带自定义字段过滤时允许省略 q（纯字段检索）；两者都空才报错
    if (!q && !Object.keys(customFilters).length)
      throw new HttpError(422, "errors.searchQueryRequired");
    return ok(await searchEverywhere(user.id, { q, customFilters }));
  });
}
