import { PrismaClient } from "@prisma/client";

// 开发模式下的热重载会重复创建 PrismaClient，用 globalThis 缓存单例
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
