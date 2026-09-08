import { z } from "zod";
import type { ToolSpec } from "./index.js";

const seg = encodeURIComponent;

// 上下文发现（AGENTS.md discover_context 的细粒度拆分）：
// MCP 工具参数须静态可声明，拆分后 LLM 按需组合，避免单次返回过载

const projectsShape = { wsSlug: z.string().optional().describe("工作区 slug，缺省 main") };
type ProjectsArgs = z.infer<z.ZodObject<typeof projectsShape>>;

const projectIdShape = {
  projectId: z.string().describe("项目 id（list_projects 返回项的 id）"),
};
type ProjectIdArgs = z.infer<z.ZodObject<typeof projectIdShape>>;

export const discoveryTools: ToolSpec<ProjectsArgs | ProjectIdArgs>[] = [
  {
    name: "list_projects",
    description:
      "列出工作区项目（含各项目 issue 计数）。返回项的 id 即其余工具的 projectId；wsSlug 缺省 main。",
    inputSchema: projectsShape,
    run: (api, a) => api.get(`/api/workspaces/${seg((a as ProjectsArgs).wsSlug ?? "main")}/projects`),
  },
  {
    name: "list_states",
    description:
      "项目状态列表。新建/变更 issue 传 stateId 前先在此查可用值；group 三档结局：ACTIVE（进行中）/COMPLETED（完成，自动记 completedAt）/CANCELLED（已取消）。",
    inputSchema: projectIdShape,
    run: (api, a) => api.get(`/api/projects/${seg((a as ProjectIdArgs).projectId)}/states`),
  },
  {
    name: "list_members",
    description: "工作区成员列表——issue 指派（assigneeIds）所需 userId 的来源；wsSlug 缺省 main。",
    inputSchema: projectsShape,
    run: (api, a) => api.get(`/api/workspaces/${seg((a as ProjectsArgs).wsSlug ?? "main")}/members`),
  },
  {
    name: "get_fields_schema",
    description:
      "项目自定义字段自描述 JSON Schema：properties 即 create_issue/update_issue 的 fieldValues 可写 key 与类型，required/enum 原样生效——服务端动态校验（未知 key、非法值、清空必填均 422）。写 issue 前必读。",
    inputSchema: projectIdShape,
    run: (api, a) => api.get(`/api/projects/${seg((a as ProjectIdArgs).projectId)}/fields/schema`),
  },
];
