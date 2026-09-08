import pkg from "../../../../package.json";
import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { mcpMetaPayload } from "@/lib/api-contract";
import { requireApiUser } from "@/server/auth/access";

export const dynamic = "force-dynamic";

// GET /api/meta —— 版本协商（docs/11-mcp-adapter.md §5.2）：solo-issue-mcp 启动
// 自检比对契约版本的数据源；Bearer/会话双通道可用，Bearer 侧豁免资源 scope
// （token.ts 的 SCOPE_EXEMPT_PATHS），过旧 X-Client 的请求会先被 426 拦下
export async function GET(req: Request) {
  return handle(async () => {
    await requireApiUser(req);
    return ok(mcpMetaPayload(pkg.version));
  });
}
