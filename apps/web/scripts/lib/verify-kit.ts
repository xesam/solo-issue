/**
 * 验收脚本共用设施（scripts/verify-*.ts 复用）
 * - 断言计数（通过/失败/跳过）+ 人话打印
 * - 机器可读汇总：`::verify-result::` JSON 行打印 + 设 CI_RESULT_FILE 时追加 JSONL（结果归档）
 * - 统一收尾 finish()：按失败数定退出码（失败必红）
 * 度量协议只在本文件演进；断言数以脚本运行输出为唯一事实源（文档不硬编码数字）。
 */
import { appendFileSync } from "node:fs";

let passed = 0;
let failed = 0;
let skipped = 0;

export function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}${extra ? `  ${extra}` : ""}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${extra ? `  ${extra}` : ""}`);
  }
}

export function skip(name: string, why: string) {
  skipped++;
  console.log(`  ⏭️  ${name}（${why}，不计入通过）`);
}

/** 非 check 通道的失败红线（脚本异常、清扫失败等），收尾计入退出码 */
export function markFailed(n = 1) {
  failed += n;
}

/** 机器可读汇总：脚本名 + 断言数 + 时间戳；CI_RESULT_FILE 由调用方（CI 验收归档）导出生效，本地直跑不落盘 */
function reportResult(script: string) {
  const line = JSON.stringify({
    script,
    passed,
    failed,
    skipped,
    ts: new Date().toISOString(),
  });
  console.log(`::verify-result:: ${line}`);
  const file = process.env.CI_RESULT_FILE;
  if (file) {
    try {
      appendFileSync(file, line + "\n");
    } catch (e) {
      console.warn(`  ⚠️ 写入 CI_RESULT_FILE 失败: ${(e as Error).message}`);
    }
  }
}

/**
 * 统一收尾：打印汇总 → 输出机器可读行 → 按失败数退出（非 0 即红）。
 * extraFail：清扫失败等额外计数，直接并入退出判定。
 */
export function finish(script: string, opts: { extraFail?: number } = {}): never {
  if (opts.extraFail) markFailed(opts.extraFail);
  console.log(
    `\n━━ 结果：${passed} 通过 / ${failed} 失败${skipped ? ` / ${skipped} 跳过` : ""} ━━`,
  );
  reportResult(script);
  process.exit(failed ? 1 : 0);
}
