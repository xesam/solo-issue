import { HttpError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type {
  ImIdentityProvider,
  ImIdentityResult,
  ImLoginFlow,
  ImMessage,
  ImNotificationChannel,
} from "../types";

// 模拟企微：零外部依赖跑通登录/通知全链路
// - 登录：/api/auth/wecom/{start,web-start} 会 302 到本应用内的"模拟企微登录页"，
//   选人后携带 code=mock:<userId> 走与真实流程完全相同的 callback（state 校验、
//   身份解析、自动入工作区、建会话）；web 流程在 mock 下降级为同一站内选人页——
//   真实的扫码界面属于企微侧，mock 环境无扫码机器人可扫
// - 通知：写入模拟收件箱（mock_messages），可在 /mock/wecom-inbox 查看
//   推送文案/去重/频控是否正确
//
// 模拟边界 = 企微世界（身份模型 v2 定案）：
// - mock 授权页只出现"企微通讯录成员"——即 origin=WECOM 的账号（含新同事首登
//   建号产物）。邮箱建号账号（管理员/脚本 persona）不属于企微世界，从不出现在
//   列表（他们的登录入口是密码登录页），也不被 code 解析接受。
// - 列表登录：用该成员名下**已存在的企微身份键**（查 identity 表，不做字符串
//   重构造——mock:new:<name> 建的号与 mock:<id> 键不同，重构造会导致克隆）。
// - 新同事（mock:new:<name>）：不预建账号，构造全新身份直接走真实首登链路。

export class WecomMockProvider implements ImIdentityProvider {
  id = "WECOM" as const;
  mode = "mock" as const;
  supportedFlows = ["in-app", "web"] as const;

  async buildAuthUrl(
    flow: ImLoginFlow,
    { state }: { state: string },
  ): Promise<string> {
    switch (flow) {
      case "in-app":
      case "web":
        return `/auth/wecom/mock?state=${encodeURIComponent(state)}`;
      default: {
        const _exhaustive: never = flow;
        throw new HttpError(400, "errors.loginFlowUnsupported", undefined, {
          flow: String(_exhaustive),
        });
      }
    }
  }

  async exchangeCode(
    flow: ImLoginFlow,
    code: string,
  ): Promise<ImIdentityResult> {
    switch (flow) {
      case "in-app":
      case "web":
        return this.resolveMockCode(code);
      default: {
        const _exhaustive: never = flow;
        throw new HttpError(400, "errors.loginFlowUnsupported", undefined, {
          flow: String(_exhaustive),
        });
      }
    }
  }

  private async resolveMockCode(code: string): Promise<ImIdentityResult> {
    if (!code.startsWith("mock:")) {
      throw new HttpError(400, "errors.mockCodeInvalid");
    }
    const rest = code.slice("mock:".length);

    // 模拟"企微通讯录存在、系统未登录过"的新同事：不预建账号，构造全新身份
    // 直接走真实首登链路——由登录流程建号（origin=WECOM、不写 email，D1/D2）。
    // 同名重提 = 同一人：providerUserId 按名字定锚，第二次起命中分支①登录本人。
    if (rest.startsWith("new:")) {
      const name = rest.slice("new:".length).trim().slice(0, 64);
      if (!name) throw new HttpError(400, "errors.mockNewNameRequired");
      return {
        providerUserId: `mock:new:${name}`,
        name,
        metadata: { mocked: true },
      };
    }

    const user = await prisma.user.findUnique({ where: { id: rest } });
    if (!user || !user.isActive) throw new HttpError(404, "errors.mockUserNotFoundOrDisabled");
    // 模拟边界 = 企微世界：邮箱建号账号（管理员/脚本 persona）不属于企微通讯录，
    // 不接受其 code——他们的登录入口是密码登录页
    if (user.origin !== "WECOM") {
      throw new HttpError(400, "errors.mockNotWecomAccount");
    }
    // 用成员名下**已存在的企微身份键**登录（查 identity 表）；
    // 不做 `mock:<email|id>` 字符串重构造——新同事首登产物的键是 mock:new:<name>，
    // 重构造必然落空，会克隆出第二个同名账号
    const identity = await prisma.identity.findFirst({
      where: { userId: user.id, provider: "WECOM" },
    });
    if (!identity) throw new HttpError(404, "errors.mockIdentityMissing");
    return {
      providerUserId: identity.providerUserId,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      metadata: { mocked: true },
    };
  }
}

export class WecomMockChannel implements ImNotificationChannel {
  id = "WECOM" as const;
  mode = "mock" as const;

  async sendToUser(providerUserId: string, message: ImMessage): Promise<void> {
    await prisma.mockMessage.create({
      data: {
        channel: "WECOM",
        toUser: providerUserId,
        title: message.title,
        summary: message.summary,
        url: message.url,
      },
    });
  }
}
