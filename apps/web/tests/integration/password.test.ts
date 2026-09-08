import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/server/auth/hash";
import { createSession } from "@/server/auth/session";
import {
  changePassword,
  hashPassword,
  verifyPasswordTimingSafe,
} from "@/server/auth/password";
import { cleanupFixtures, mkUser } from "./helpers";

afterAll(async () => {
  await cleanupFixtures();
});

describe("密码原语", () => {
  it("hashPassword 产出 bcrypt 可校验散列；不同明文散列不同", async () => {
    const h1 = await hashPassword("correct horse battery staple");
    expect(await verifyPasswordTimingSafe("correct horse battery staple", h1)).toBe(true);
    expect(await verifyPasswordTimingSafe("wrong", h1)).toBe(false);
    expect(await hashPassword("same")).not.toBe(await hashPassword("same")); // 加盐
  });

  it("verifyPasswordTimingSafe 对不存在的账号（hash=null）返回 false 且不炸（走 DUMMY 恒时比较；时序曲线从公开接口不可观测，由实现注释与实现本身背书）", async () => {
    // 可锚定的语义面：不炸、false（DUMMY_HASH 分支在实现里恒走一次 bcrypt.compare，
    // 该恒时性无公开接口可断言——e2e 亦不覆盖，防退化靠 code review，见 password.ts 注释）
    expect(await verifyPasswordTimingSafe("whatever", null)).toBe(false);
  });
});

describe("changePassword（写哈希 + 清标记 + 吊销其他会话）", () => {
  it("改密后旧密码失效、新密码生效、mustChangePassword 复位", async () => {
    const u = await mkUser({ passwordHash: await hashPassword("初始密码123"), mustChangePassword: true });
    await changePassword(u.id, "新密码456");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.mustChangePassword).toBe(false);
    expect(await verifyPasswordTimingSafe("初始密码123", after.passwordHash!)).toBe(false);
    expect(await verifyPasswordTimingSafe("新密码456", after.passwordHash!)).toBe(true);
  });

  it("传 keepSessionHash 保留当前会话、吊销其他；不传全吊销", async () => {
    const u = await mkUser({ passwordHash: await hashPassword("可改密码789") });
    const keepToken = await createSession(u.id, { ip: "1.1.1.1" });
    const otherToken = await createSession(u.id, { ip: "2.2.2.2" });

    await changePassword(u.id, "改后密码012", hashToken(keepToken));
    const keepRow = await prisma.session.findUnique({ where: { id: hashToken(keepToken) } });
    const otherRow = await prisma.session.findUnique({ where: { id: hashToken(otherToken) } });
    expect(keepRow).toBeTruthy(); // 当前设备在线
    expect(otherRow).toBeNull(); // 旧设备下线

    const later = await createSession(u.id, {});
    await changePassword(u.id, "再改密码345"); // 不传 → 全吊销
    expect(await prisma.session.findUnique({ where: { id: hashToken(later) } })).toBeNull();
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
  });
});
