// 一次性数据订正：默认状态配色调整（待梳理→紫、待办→蓝）后，
// 把存量项目里仍是旧默认色的状态刷成新配色。
// 匹配口径从严——「状态名 + 颜色」双精确等于旧默认值才替换：
// 用户在项目设置里自定义过颜色的同名状态一律跳过，不动用户数据。
// 幂等可重跑：已是新色的状态不再匹配旧值，二次运行零替换。
// 用法: pnpm refresh-state-colors
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 与 src/server/services/project.ts 的 DEFAULT_STATES 配色变更同步维护；
// 颜色未动的默认状态（进行中/已完成/已取消）不在此表。
const MIGRATIONS = [
  { name: "待梳理", from: "#64748b", to: "#8b5cf6" },
  { name: "待办", from: "#64748b", to: "#3b82f6" },
];

async function main() {
  const states = await prisma.state.findMany({
    include: { project: { select: { name: true } } },
  });
  let replaced = 0;
  let skipped = 0;
  for (const s of states) {
    const m = MIGRATIONS.find((x) => x.name === s.name);
    if (!m) continue; // 非迁移目标（其余默认状态与用户自建状态）
    if (s.color === m.to) continue; // 已刷过（幂等）
    if (s.color !== m.from) {
      skipped += 1;
      console.log(`ℹ️  跳过自定义颜色状态：${s.project.name} / ${s.name}（当前 ${s.color}，非旧默认 ${m.from}）`);
      continue;
    }
    await prisma.state.update({ where: { id: s.id }, data: { color: m.to } });
    replaced += 1;
    console.log(`✅ ${s.project.name} / ${s.name}：${m.from} → ${m.to}`);
  }
  console.log(`✅ 完成：替换 ${replaced} 处，跳过自定义 ${skipped} 处（共扫描 ${states.length} 个状态）`);
}

main()
  .catch((e) => {
    console.error("❌ 默认状态配色订正失败:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
