import { ok } from "@/lib/api";
import { handle } from "@/lib/api-server";
import { getWecomProvider } from "@/server/im/wecom";

export const dynamic = "force-dynamic";

// 登录页获取已启用的登录方式（公开）。
// flows 是服务端的能力宣告（凭证 + 实现共同决定），登录页结合自身环境
// （UA/设备）选择入口——能力/环境分离，服务端不猜浏览器
export async function GET() {
  return handle(async () => {
    const provider = await getWecomProvider();
    return ok({
      wecom: provider
        ? { enabled: true, mode: provider.mode, flows: provider.supportedFlows }
        : { enabled: false, mode: null, flows: [] as const },
    });
  });
}
