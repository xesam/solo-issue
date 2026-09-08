import { ok, HttpError } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { prisma } from "@/lib/prisma";
import { getWecomProvider } from "@/server/im/wecom";
import { requireApiUser } from "@/server/auth/access";

export const dynamic = "force-dynamic";

// 模拟收件箱（仅 mock 模式 + 需登录；可视化验证 IM 推送文案/去重/频控）
export async function GET(req: Request) {
  return handle(async () => {
    await requireApiUser(req);
    const provider = await getWecomProvider();
    if (!provider || provider.mode !== "mock")
      throw new HttpError(403, "errors.mockNotEnabled");

    const messages = await prisma.mockMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return ok(messages);
  });
}
