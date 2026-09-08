import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/server/auth/access";
import { createApiToken, TOKEN_FIELDS } from "@/server/auth/token";
import { createApiTokenSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

// 会话专用（Bearer 禁区）：API 令牌的自助管理

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    const tokens = await prisma.apiToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: TOKEN_FIELDS,
    });
    return ok(tokens);
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireApiUser(req);
    const input = parse(createApiTokenSchema, await readBody(req));
    const { token, record } = await createApiToken(user.id, {
      name: input.name,
      scopes: input.scopes,
      expiresInDays: input.expiresInDays ?? null,
    });
    // token 仅此一次返回；入库的是哈希。响应字段走与 GET 同一份 select——
    // spread record 会把 tokenHash 一并带给客户端，泄露内部列
    return ok({ ...record, token }, 201);
  });
}
