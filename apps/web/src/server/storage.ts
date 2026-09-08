import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { env } from "@/lib/env";

// 附件存储适配层：MVP 本地磁盘；换 S3/MinIO 时只需替换本模块实现

// 空串与缺省一致回退默认目录（?? 不吃空串，会让文件落到 cwd）
const ROOT = process.env.UPLOAD_DIR?.trim() || "uploads";
// 经 env() 的 zod 校验（env.ts），非数字值启动即失败，杜绝 NaN 使上限恒失效
const MAX_UPLOAD_MB = env().MAX_UPLOAD_MB;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/**
 * key 形如 "<issueId>/<uuid>-<安全文件名>"。
 * 穿越安全不靠字符清洗（字符集保留 "."，"uuid-.." 依然能拼出），
 * 而靠 randomUUID() 前缀：随机段使 ".." 永不可能构成完整路径段。
 */
export function resolveKey(issueId: string, filename: string) {
  const safe = filename
    .replace(/[^\w.\-\u4e00-\u9fa5]/g, "_")
    .slice(-100);
  return `${issueId}/${randomUUID()}-${safe}`;
}

function absPath(key: string) {
  const rootDir = path.resolve(ROOT);
  const p = path.resolve(rootDir, key);
  // resolveKey 兑现的契约在此兜底：key 一旦越出 ROOT（调用方直传越界键，
  // 或 DB 里的 storageKey 被篡改）即刻拒绝，不依赖调用方自律
  if (!p.startsWith(rootDir + path.sep))
    throw new Error(`非法存储键：${key}`);
  return p;
}

export async function putFile(key: string, data: Buffer) {
  const p = absPath(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data);
}

export async function getFile(key: string): Promise<Buffer> {
  return readFile(absPath(key));
}

export async function deleteFile(key: string) {
  await unlink(absPath(key)).catch(() => {});
}
