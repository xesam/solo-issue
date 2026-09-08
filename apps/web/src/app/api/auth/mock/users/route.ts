import { ok, HttpError } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { prisma } from "@/lib/prisma";
import { getWecomProvider } from "@/server/im/wecom";

export const dynamic = "force-dynamic";

// 仅在模拟模式可用：列出"企微通讯录成员"——只含 origin=WECOM 的账号
// （邮箱建号账号不属于企微世界，从不出现在此列表；其登录入口是密码登录页）。
// （新同事建号不经此路由——mock 授权页表单构造 mock:new:<name> code 直接走
// 企微首登建号链路，与真实语义一致；预建 POST 已随之退役）
export async function GET() {
  return handle(async () => {
    const provider = await getWecomProvider();
    if (!provider || provider.mode !== "mock")
      throw new HttpError(403, "errors.mockNotEnabled");
    const users = await prisma.user.findMany({
      where: { isActive: true, origin: "WECOM" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return ok(users);
  });
}
