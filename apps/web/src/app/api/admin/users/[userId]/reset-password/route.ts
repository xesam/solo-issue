import { ok, parse, readBody } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireInstanceAdmin } from "@/server/auth/access";
import { adminResetPassword } from "@/server/services/admin-user";
import { adminResetPasswordSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

// 管理台：重置密码（强制下次改密 + 全会话下线）

export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  return handle(async () => {
    await requireInstanceAdmin(req);
    const { userId } = await params;
    const input = parse(adminResetPasswordSchema, await readBody(req));
    await adminResetPassword(userId, input.newPassword);
    return ok({ reset: true });
  });
}
