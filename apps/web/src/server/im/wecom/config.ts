import { prisma } from "@/lib/prisma";

// 企微配置解析：env 优先，其次 ProviderCredential 表（预留读路径——当前无管理端
// 写入端点，接入管理台前该路径不可用）；凭证齐全 → real；否则开发环境默认 mock；
// 都没有 → 未启用

export interface WecomConfig {
  corpId: string;
  agentId: string;
  secret: string;
  mode: "real" | "mock";
}

function allowMock() {
  const flag = process.env.ALLOW_IM_MOCK;
  // 同时接受 "true" 与 "1"——docs/README 只这两个口径出现，此处不再窄化
  if (flag !== undefined) return flag === "true" || flag === "1";
  return process.env.NODE_ENV !== "production";
}

export async function getWecomConfig(): Promise<WecomConfig | null> {
  // 1) 环境变量
  const corpId = process.env.WECOM_CORP_ID;
  const agentId = process.env.WECOM_AGENT_ID;
  const secret = process.env.WECOM_SECRET;
  if (corpId && agentId && secret) {
    return { corpId, agentId, secret, mode: "real" };
  }

  // 2) 数据库配置（ProviderCredential 表备选路径，供管理端维护；env 优先）
  try {
    const row = await prisma.providerCredential.findUnique({
      where: { provider: "WECOM" },
    });
    const cfg = row?.config as
      | { corpId?: string; agentId?: string; secret?: string }
      | undefined;
    if (cfg?.corpId && cfg?.agentId && cfg?.secret) {
      return { ...cfg, mode: "real" } as WecomConfig;
    }
  } catch (e) {
    // 构建期库未就绪等启动性问题忽略；运行期 DB 抖动也会落到这里——
    // 必须留痕，否则下游的"IM 通道未配置"日志会把 DB 故障误诊为配置缺失
    console.warn("[wecom-config] 读取 ProviderCredential 失败，回退 env/mock 判断:", e);
  }

  // 3) 模拟模式（显式开关优先，默认非生产开启）
  if (allowMock()) {
    return { corpId: "mock", agentId: "mock", secret: "mock", mode: "mock" };
  }
  return null;
}
