import { createHash } from "crypto";

/**
 * 无前缀令牌 → 持久化指纹（SHA-256）。
 * 会话 Cookie 与 API Token 共用：库里只存哈希，明文不落库。
 * （原因：两者格式/生命周期不同，但指纹算法必须唯一——抽到此处防漂移。）
 */
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
