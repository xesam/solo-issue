import type { ZodRawShape } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient } from "../http.js";
import { errorResult, okResult } from "../errors.js";
import { commentTools } from "./comments.js";
import { discoveryTools } from "./discovery.js";
import { issueTools } from "./issues.js";
import { searchTools } from "./search.js";

// 工具注册器：specs 为包内私有结构（name/描述/zod 形状/执行体），
// run 返回原始 data，统一在注册层剥壳成 tool result——错误也统一在此转译

export type ToolSpec<A = Record<string, unknown>> = {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  run: (api: ApiClient, args: A) => Promise<unknown>;
};

// 各工具的 A 为 z.infer 参数类型；any 只出现在聚合处（类型在此处擦除，注册时由 SDK 校验）
const specs: ToolSpec<any>[] = [
  ...discoveryTools,
  ...searchTools,
  ...issueTools,
  ...commentTools,
];

export function registerTools(server: McpServer, api: ApiClient) {
  for (const spec of specs) {
    server.registerTool(
      spec.name,
      { title: spec.name, description: spec.description, inputSchema: spec.inputSchema },
      async (args) => {
        try {
          return okResult(await spec.run(api, args));
        } catch (e) {
          return errorResult(e);
        }
      },
    );
  }
}

export const toolNames = specs.map((s) => s.name);
