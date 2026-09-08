// E2E 数据卫生兜底：直连 DB 清扫本套件的 E2E-* 数据。
// 判据：真实删除旅程仍由 spec 内 UI 点击走（覆盖 ConfirmDialog）；
// 本清扫只兜「失败/中断的尝试残留」——不依赖断言路径，beforeAll/afterAll 各扫一遍。
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const E2E_TITLE_PREFIX = "E2E-";

export async function sweepE2eData(): Promise<number> {
  const ws = await prisma.workspace.findUnique({ where: { slug: "main" } });
  if (!ws) return 0;
  const projects = await prisma.project.findMany({
    where: { workspaceId: ws.id },
    select: { id: true },
  });
  // 评论/活动/通知随 issue 级联删除；不用 SEED 数据
  const res = await prisma.issue.deleteMany({
    where: {
      projectId: { in: projects.map((p) => p.id) },
      title: { startsWith: E2E_TITLE_PREFIX },
    },
  });
  return res.count;
}
