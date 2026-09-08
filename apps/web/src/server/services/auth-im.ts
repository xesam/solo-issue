import { HttpError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { ImIdentityResult } from "@/server/im/types";
import { recordTranslator } from "./notification";

// IM 登录的身份落点（身份模型 v2，D1-D6 定局 2026-10-21）：
// ① Identity 已存在 → 直接登录
// ③ 全新 → 建号（origin=provider）+ 附加身份 + 自动入第一个工作区（单工作区 MVP 简化；多工作区后由管理端分配）
//
// email 对 IM 登录是纯档案属性：不作为匹配/合并/登录凭据。
// 原邮箱合并分支已按设计决策移除——同自然人跨渠道 = 不同账号；
// 建号不写 User.email，渠道侧带回的资料（含邮箱）仅存 Identity.metadata。
// providerUserId 的语义稳定性由使用方对照渠道官方文档自担，系统不做兜底。

export async function loginWithImIdentity(
  provider: "WECOM",
  identity: ImIdentityResult,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.identity.findUnique({
      where: {
        provider_providerUserId: {
          provider,
          providerUserId: identity.providerUserId,
        },
      },
      include: { user: true },
    });
    if (existing) {
      if (!existing.user.isActive) throw new HttpError(403, "errors.accountDisabled");
      await tx.identity.update({
        where: { id: existing.id },
        data: { lastLoginAt: new Date() },
      });
      return existing.user;
    }

    // 全新建号：唯一登录凭据 = (provider, providerUserId)，永不按邮箱并入既有账号
    const t = await recordTranslator();
    const user = await tx.user.create({
      data: {
        name: identity.name ?? t("im.defaultUserName"),
        avatarUrl: identity.avatarUrl ?? null,
        origin: provider,
      },
    });

    await tx.identity.create({
      data: {
        userId: user.id,
        provider,
        providerUserId: identity.providerUserId,
        metadata: (identity.metadata ?? {}) as object,
        lastLoginAt: new Date(),
      },
    });

    const workspace = await tx.workspace.findFirst({
      orderBy: { createdAt: "asc" },
    });
    if (workspace) {
      await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
        },
        update: {},
        create: { workspaceId: workspace.id, userId: user.id, role: "MEMBER" },
      });
    }

    return user;
  });
}
