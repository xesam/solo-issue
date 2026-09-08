import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// 健康检查端点：供容器探活与运维监控使用
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({
      status: "ok",
      db: "up",
      time: new Date().toISOString(),
    });
  } catch {
    return Response.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
