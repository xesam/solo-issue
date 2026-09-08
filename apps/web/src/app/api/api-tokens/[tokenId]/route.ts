import { ok, parse, readBody, HttpError } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/server/auth/access";
import { renameApiTokenSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

// DELETE /api/api-tokens/:id —— 撤销自己的令牌
// PATCH /api/api-tokens/:id —— 重命名自己的令牌（scope/有效期不可改：签发即定，需变更请重建令牌）
// 防枚举口径与全库一致：不存在与"别人的"均报 404（他人令牌存在与否不可探测）。
// 写操作以 { id, userId } 复合条件一步到位——省去先查后写的 TOCTOU 窗口。
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  return handle(async () => {
    const { tokenId } = await params;
    const user = await requireApiUser(req);
    const { name } = parse(renameApiTokenSchema, await readBody(req));
    const updated = await prisma.apiToken.updateMany({
      where: { id: tokenId, userId: user.id },
      data: { name },
    });
    if (updated.count === 0) throw new HttpError(404, "errors.tokenNotFound");
    return ok({ id: tokenId, name });
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  return handle(async () => {
    const { tokenId } = await params;
    const user = await requireApiUser(req);
    const deleted = await prisma.apiToken.deleteMany({
      where: { id: tokenId, userId: user.id },
    });
    if (deleted.count === 0) throw new HttpError(404, "errors.tokenNotFound");
    return ok({ id: tokenId });
  });
}
