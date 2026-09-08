import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// 本地账号密码：bcrypt 存储；防枚举的恒时校验

// DUMMY_HASH 是 cost=10 的 bcrypt 哈希——与 hashPassword 的 cost 必须保持一致，
// 否则"用户不存在"分支与真实分支的耗时曲线漂移，恒时防御静默退化
const DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17LyWy"; // 用于恒时比较

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

/** 防账号枚举：无论用户是否存在，都执行一次 bcrypt 比较，错误信息统一在调用方处理 */
export async function verifyPasswordTimingSafe(plain: string, hash: string | null) {
  if (!hash) {
    await bcrypt.compare(plain, DUMMY_HASH); // 恒时：吞掉用户不存在的时差
    return false;
  }
  return bcrypt.compare(plain, hash);
}

/** 自助/强制改密：写哈希、清标记、吊销其他会话（传 keepSessionHash 时保留当前会话；不传则吊销全部） */
export async function changePassword(
  userId: string,
  newPassword: string,
  keepSessionHash?: string,
) {
  const hash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash: hash, mustChangePassword: false },
    });
    // 吊销其他会话（改密后旧设备下线）
    await tx.session.deleteMany({
      where: keepSessionHash
        ? { userId, NOT: { id: keepSessionHash } }
        : { userId },
    });
  });
}
