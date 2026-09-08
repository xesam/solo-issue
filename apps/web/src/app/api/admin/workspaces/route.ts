import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireInstanceAdmin } from "@/server/auth/access";
import { adminListWorkspaces, adminCreateWorkspace } from "@/server/services/admin-user";
import { createWorkspaceSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    await requireInstanceAdmin(req);
    return ok(await adminListWorkspaces());
  });
}

// U2.2：创建工作区（超级管理员；新工作区默认无人，需在用户表里“加入工作区”）
export async function POST(req: Request) {
  return handle(async () => {
    await requireInstanceAdmin(req);
    const input = parse(createWorkspaceSchema, await readBody(req));
    return ok(await adminCreateWorkspace(input), 201);
  });
}
