import { z } from "zod";
import type { ToolSpec } from "./index.js";
import { withFieldFilters } from "../http.js";

const seg = encodeURIComponent;

// 不传 = 不写字段；null 值清空，必填不可清空（AGENTS.md 语义）
const fieldValues = z
  .record(z.unknown())
  .optional()
  .describe("自定义字段值 { key: value }，key/类型/枚举以 get_fields_schema 为准；null 表示清空，必填不可清空");

const projectId = z.string().describe("项目 id（list_projects 返回项的 id）");
const number = z.number().int().positive().describe("项目内 issue 序号（如 PROJ-123 的 123）");

const listShape = {
  projectId,
  stateId: z.string().optional(),
  assigneeId: z.string().optional().describe("按指派人过滤（userId 来自 list_members）"),
  q: z.string().optional().describe("标题/描述关键词"),
  archived: z.string().optional().describe("归档筛选，传给服务端原样处理"),
  orderBy: z.enum(["createdAt", "updatedAt"]).optional(),
  orderDir: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().min(1).optional().describe("页码，1 起，缺省 1"),
  pageSize: z.number().int().min(10).max(500).optional().describe("页大小 10–500，缺省 50"),
  filters: z.record(z.string()).optional().describe("自定义字段过滤 { key: value }（仅 SELECT 可检索）"),
};
type ListArgs = z.infer<z.ZodObject<typeof listShape>>;

const detailShape = { projectId, number };
type DetailArgs = z.infer<z.ZodObject<typeof detailShape>>;

const createShape = {
  projectId,
  title: z.string().min(1),
  descriptionText: z.string().optional().describe("富文本描述的纯文本形态（提及会渲染为 @姓名）"),
  stateId: z.string().optional().describe("缺省取项目默认状态；显式传入须是 list_states 中的有效值"),
  assigneeIds: z.array(z.string()).optional().describe("指派给哪些成员（userId 来自 list_members）"),
  fieldValues,
};
type CreateArgs = z.infer<z.ZodObject<typeof createShape>>;

const updateShape = {
  projectId,
  number,
  title: z.string().min(1).optional(),
  descriptionText: z.string().optional(),
  stateId: z.string().optional().describe("变更状态会写活动并通知相关同事；进入 COMPLETED 组自动记 completedAt"),
  assigneeIds: z.array(z.string()).optional(),
  fieldValues,
  isArchived: z.boolean().optional().describe("归档/取消归档"),
};
type UpdateArgs = z.infer<z.ZodObject<typeof updateShape>>;

export const issueTools: ToolSpec<ListArgs | DetailArgs | CreateArgs | UpdateArgs>[] = [
  {
    name: "list_issues",
    description: "项目内 issue 列表：状态/指派/关键词/自定义字段过滤与分页。返回 { issues, total, page, pageSize }。",
    inputSchema: listShape,
    run: (api, a) => {
      const l = a as ListArgs;
      const { filters, ...rest } = l;
      return api.get(
        `/api/projects/${seg(l.projectId)}/issues`,
        withFieldFilters(filters, { ...rest, projectId: undefined }),
      );
    },
  },
  {
    name: "read_issue",
    description: "读取 issue 详情（状态、负责人、创建人、fieldValues）。",
    inputSchema: detailShape,
    run: (api, a) => {
      const d = a as DetailArgs;
      return api.get(`/api/projects/${seg(d.projectId)}/issues/${d.number}`);
    },
  },
  {
    name: "read_history",
    description: "读取 issue 活动流（谁在何时改了什么——审计视角，倒序最近 100 条）。",
    inputSchema: detailShape,
    run: (api, a) => {
      const d = a as DetailArgs;
      return api.get(`/api/projects/${seg(d.projectId)}/issues/${d.number}/activities`);
    },
  },
  {
    name: "create_issue",
    description:
      "创建 issue（项目内自增序号）。先 get_fields_schema 确认 fieldValues 的 key 与类型、list_members 取 userId。无幂等键：调用失败后先 search_everything 确认未重复创建，再补建。",
    inputSchema: createShape,
    run: (api, a) => {
      const c = a as CreateArgs;
      return api.post(`/api/projects/${seg(c.projectId)}/issues`, {
        title: c.title,
        descriptionText: c.descriptionText,
        stateId: c.stateId,
        assigneeIds: c.assigneeIds,
        fieldValues: c.fieldValues,
      });
    },
  },
  {
    name: "update_issue",
    description:
      "部分更新：只传需要变更的字段，未传字段不动，多次调用安全。状态变更/指派/字段变更自动通知相关同事，无需另发通知。",
    inputSchema: updateShape,
    run: (api, a) => {
      const u = a as UpdateArgs;
      return api.patch(`/api/projects/${seg(u.projectId)}/issues/${u.number}`, {
        title: u.title,
        descriptionText: u.descriptionText,
        stateId: u.stateId,
        assigneeIds: u.assigneeIds,
        fieldValues: u.fieldValues,
        isArchived: u.isArchived,
      });
    },
  },
];
