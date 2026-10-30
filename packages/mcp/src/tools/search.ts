import { z } from "zod";
import type { ToolSpec } from "./index.js";
import { withFieldFilters } from "../http.js";

// search_everything（AGENTS.md 同名工具）：跨工作区全局搜索，
// filters 转译为 cf.<key>=<value>（单选等值、多选包含；仅 SELECT 可检索）

const filtersShape = z
  .record(z.string())
  .optional()
  .describe("自定义字段等值过滤 { key: value }——key 必须是项目已定义的可检索字段，先 get_fields_schema；与 q 至少其一，都缺则 422");

const shape = { q: z.string().optional().describe("标题/描述关键词"), filters: filtersShape };
type Args = z.infer<z.ZodObject<typeof shape>>;

export const searchTools: ToolSpec<Args>[] = [
  {
    name: "search_everything",
    description:
      "跨工作区全局搜索 issue 与项目：issue 结果含可直接给用户的深链 url 与 fieldValues，项目名命中给项目页深链（q 为空的纯字段检索时项目组为空）。q 与 filters 至少其一（都缺则 422）；字段过滤仅作用于 issue；多选字段为包含语义。",
    inputSchema: shape,
    run: (api, a) => api.get("/api/search", withFieldFilters(a.filters, { q: a.q })),
  },
];
