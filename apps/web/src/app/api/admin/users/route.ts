import { ok, parse, readBody, HttpError } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { requireInstanceAdmin } from "@/server/auth/access";
import { adminCreateUser, adminListUsers } from "@/server/services/admin-user";
import { adminCreateUserSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";

// 管理台：用户列表 / 建号（均需超级管理员）
// U3.3：列表支持 q/status/adminOnly/take/skip 过滤分页，返回 {total, users}

function pagingParam(raw: string | null, name: string): number | undefined {
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  // NaN 直通会把 Prisma 校验错炸成 500；非法数字一律 422 给人话
  if (!Number.isInteger(n) || n < 0)
    throw new HttpError(422, "errors.nonNegativeInteger", undefined, { name });
  return n;
}

export async function GET(req: Request) {
  return handle(async () => {
    await requireInstanceAdmin(req);
    const sp = new URL(req.url).searchParams;
    const statusRaw = sp.get("status");
    // 只收两值，非法值拒绝而非静默放行为全表（"as" 强转是撒谎）
    if (statusRaw !== null && !["active", "disabled"].includes(statusRaw))
      throw new HttpError(422, "errors.statusInvalid");
    return ok(
      await adminListUsers({
        q: sp.get("q")?.trim() || undefined,
        status: (statusRaw as "active" | "disabled") || undefined,
        adminOnly: sp.get("adminOnly") === "true" || undefined,
        take: pagingParam(sp.get("take"), "take"),
        skip: pagingParam(sp.get("skip"), "skip"),
      }),
    );
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireInstanceAdmin(req);
    const input = parse(adminCreateUserSchema, await readBody(req));
    const user = await adminCreateUser(input);
    return ok({ id: user.id, name: user.name, email: user.email }, 201);
  });
}
