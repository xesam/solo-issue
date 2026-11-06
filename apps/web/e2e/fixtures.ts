// E2E 数据卫生兜底：直连 DB 清扫本套件的 E2E-* 数据。
// 判据：真实删除旅程仍由 spec 内 UI 点击走（覆盖 ConfirmDialog）；
// 本清扫只兜「失败/中断的尝试残留」——不依赖断言路径，beforeEach/afterEach 各扫一遍。
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const E2E_MARKER_PREFIX = "E2E-";

export async function sweepE2eData(): Promise<void> {
  const ws = await prisma.workspace.findUnique({ where: { slug: "main" } });
  if (!ws) return;
  const projects = await prisma.project.findMany({
    where: { workspaceId: ws.id },
    select: { id: true },
  });
  // 评论/活动/通知随 issue 级联删除；不用 SEED 数据
  // 判据走 descriptionText 前缀（spec 的标记写在描述正文首行）
  await prisma.issue.deleteMany({
    where: {
      projectId: { in: projects.map((p) => p.id) },
      descriptionText: { startsWith: E2E_MARKER_PREFIX },
    },
  });
}
