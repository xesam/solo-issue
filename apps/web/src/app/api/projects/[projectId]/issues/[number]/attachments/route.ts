import { ok, requireIssueNumber, HttpError } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { MAX_UPLOAD_BYTES } from "@/server/storage";
import { requireProject, requireProjectWrite } from "@/server/auth/access";
import { createAttachment, listAttachments } from "@/server/services/attachment";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; number: string }> },
) {
  return handle(async () => {
    const { projectId, number } = await params;
    await requireProject(req, projectId);
    return ok(await listAttachments(projectId, requireIssueNumber(number)));
  });
}

// multipart/form-data: file
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; number: string }> },
) {
  return handle(async () => {
    const { projectId, number } = await params;
    const { user } = await requireProjectWrite(req, projectId);

    // 体积闸尽量前置：Content-Length 是客户端自报（可谎报），但零成本拦下诚实的大上传；
    // formData() 解析仍会在内存中缓冲整个 multipart（App Router 路由无请求体上限），
    // 面对恶意谎报客户端，真正的边界在反代层（nginx client_max_body_size 等），
    // 服务端闸能保证的是：超限文件绝不落库、不二次缓冲（arrayBuffer 前即拒）
    const declaredSize = Number(req.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_UPLOAD_BYTES + 64 * 1024)
      throw new HttpError(413, "errors.attachmentTooLarge");

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string")
      throw new HttpError(422, "errors.missingField", undefined, { name: "file" });

    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "errors.attachmentTooLarge");

    const att = await createAttachment({
      projectId,
      number: requireIssueNumber(number),
      uploaderId: user.id,
      filename: file.name || "附件",
      mimeType: file.type,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return ok(att, 201);
  });
}
