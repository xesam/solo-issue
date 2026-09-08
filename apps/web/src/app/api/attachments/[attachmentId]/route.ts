import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireApiUser } from "@/server/auth/access";
import { readAttachment, removeAttachment } from "@/server/services/attachment";

export const dynamic = "force-dynamic";

// 附件内容（登录态，按项目可见性判定：公开 ∪ 项目成员 ∪ 工作区 OWNER，404 防枚举）。
// 全量缓冲返回（MAX_UPLOAD_MB 上限内），非流式。
// mimeType 是上传时客户端自报的——同源响应里放行 text/html 等于给上传者送 XSS 权限，
// inline 只给纯位图白名单，其余一律 octet-stream + attachment 强制下载
const INLINE_SAFE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  return handle(async () => {
    const { attachmentId } = await params;
    const user = await requireApiUser(req);
    const { att, buffer } = await readAttachment(attachmentId, user.id);
    const safe = INLINE_SAFE_TYPES.has(att.mimeType);
    const bytes = new Uint8Array(buffer); // 拷贝而非引用：Node Buffer 可能是共享池切片
    return new Response(bytes, {
      headers: {
        "Content-Type": safe ? att.mimeType : "application/octet-stream",
        // 实发字节而非 DB 记录值：磁盘截断/人为改库时两者会不一致，浏览器报长度错
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `${safe ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  return handle(async () => {
    const { attachmentId } = await params;
    const user = await requireApiUser(req);
    await removeAttachment(attachmentId, user.id);
    return ok({ success: true });
  });
}
