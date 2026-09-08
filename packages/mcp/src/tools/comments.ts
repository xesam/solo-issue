import { z } from "zod";
import type { ToolSpec } from "./index.js";

const seg = encodeURIComponent;

const shape = {
  projectId: z.string().describe("项目 id（list_projects 返回项的 id）"),
  number: z.number().int().positive().describe("项目内 issue 序号"),
  body: z
    .record(z.unknown())
    .describe(
      'Tiptap JSON 文档，如 { "type": "doc", "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "..." } ] } ] }；@提及用节点 { "type": "mention", "attrs": { "id": "<userId>", "label": "<姓名>" } }',
    ),
};
type Args = z.infer<z.ZodObject<typeof shape>>;

export const commentTools: ToolSpec<Args>[] = [
  {
    name: "add_comment",
    description:
      "发表评论（Tiptap JSON 文档，支持 @提及）。评论与提及自动通知相关同事（指派人与创建人、历史评论者、被提及者）。",
    inputSchema: shape,
    run: (api, a) =>
      api.post(`/api/projects/${seg(a.projectId)}/issues/${a.number}/comments`, { body: a.body }),
  },
];
