import { HttpError } from "@/lib/api";
import { translatorFor } from "@/i18n/server";
import type { Locale } from "@/i18n/config";
import type {
  ImIdentityProvider,
  ImIdentityResult,
  ImLoginFlow,
  ImMessage,
  ImNotificationChannel,
} from "../types";

// 真实企业微信适配器（自建应用）
// 端点以企微官方文档为准，联调时如报错先核对 URL 是否随版本调整
// 凭证配置与企微应用侧设置步骤：docs/09-wecom-setup.md「接入企业微信」

const API = "https://qyapi.weixin.qq.com/cgi-bin";

// 企微 textcard 限制按「字节」计（title 128B / description 512B），中文 3B/字。
// String.slice 按 code unit 截，量纲不换算会让长中文摘要直接超限报 40058，
// 故按 UTF-8 字节边界截断，且不从多字节字符中间截开。
function truncateUtf8(s: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(s);
  if (bytes.length <= maxBytes) return s;
  // 回退到不截断多字节字符的首字节位置
  let cut = maxBytes;
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut--;
  return new TextDecoder().decode(bytes.slice(0, cut));
}

export class WecomRealProvider implements ImIdentityProvider {
  id = "WECOM" as const;
  mode = "real" as const;
  supportedFlows = ["in-app", "web"] as const;

  constructor(
    private cfg: { corpId: string; agentId: string; secret: string },
  ) {}

  async buildAuthUrl(
    flow: ImLoginFlow,
    {
      state,
      redirectUri,
      userAgent,
    }: {
      state: string;
      redirectUri: string;
      userAgent?: string;
    },
  ): Promise<string> {
    switch (flow) {
      case "in-app": {
        // 本系统定位为企微内建应用：仅支持企微客户端内 snsapi_base 静默免登；
        // 不提供 PC 浏览器在企微 WebView 内的 OAuth——那是 in-app 的语义边界
        const inWeCom = /wxwork/i.test(userAgent ?? "");
        if (!inWeCom) {
          throw new HttpError(400, "errors.wecomClientRequired");
        }
        return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${this.cfg.corpId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=snsapi_base&state=${encodeURIComponent(state)}#wechat_redirect`;
      }
      case "web":
        // 系统浏览器（PC）Web 登录：wwlogin 登录页（扫码；桌面端企微在线时可快速登录）。
        // 回调域名须为应用的 OAuth 可信域名或 Web 网页授权回调域名（与 in-app 同源配置）
        return `https://login.work.weixin.qq.com/wwlogin/sso/login?login_type=CorpApp&appid=${this.cfg.corpId}&agentid=${this.cfg.agentId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
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
      // 两种流程的 code 都由 auth/getuserinfo 换身份（企微 Web 登录与
      // snsapi_base 复用同一接口，见官方文档 98176/91023），实现上无分支差异
      case "in-app":
      case "web":
        return this.fetchIdentityByCode(code);
      default: {
        const _exhaustive: never = flow;
        throw new HttpError(400, "errors.loginFlowUnsupported", undefined, {
          flow: String(_exhaustive),
        });
      }
    }
  }

  private async fetchIdentityByCode(code: string): Promise<ImIdentityResult> {
    // token 失效自愈：40014/42001 = access_token 硬过期或被互踢（app 与 worker
    // 两进程各持一份缓存，任何一侧刷新都会踢对方；登录路径与 Channel 发送
    // 同口径——清缓存重取一次再试，仍失败才把错误抛给回调层）
    const fetchInfo = async () => {
      const token = await this.getAccessToken();
      const res = await fetch(
        `${API}/auth/getuserinfo?access_token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`,
      );
      return (await res.json()) as {
        errcode: number;
        errmsg?: string;
        userid?: string;
        // Web 登录流程可能扫出非企业成员：返回 openid 而非 userid
        openid?: string;
      };
    };
    let info = await fetchInfo();
    if (info.errcode === 40014 || info.errcode === 42001) {
      this.invalidateAccessToken();
      info = await fetchInfo();
    }
    if (info.errcode === 0 && !info.userid && info.openid) {
      throw new HttpError(403, "errors.wecomMembersOnly");
    }
    if (info.errcode !== 0 || !info.userid) {
      throw new HttpError(401, "errors.wecomAuthExchangeFailed", undefined, {
        errcode: info.errcode,
        errmsg: info.errmsg ?? "",
      });
    }

    // 成员详情（读取失败不阻塞登录，降级用 userid）
    const token = await this.getAccessToken();
    const userRes = await fetch(
      `${API}/user/get?access_token=${encodeURIComponent(token)}&userid=${encodeURIComponent(info.userid)}`,
    );
    const u = (await userRes.json()) as {
      errcode: number;
      name?: string;
      email?: string;
      biz_mail?: string;
      thumb_avatar?: string;
      avatar?: string;
      status?: number;
    };
    return {
      providerUserId: info.userid,
      name: u.errcode === 0 ? (u.name ?? info.userid) : info.userid,
      // 企业邮箱优先，验证邮箱兜底——纯档案资料（身份模型 v2：email 不再参与
      // 身份匹配/合并，仅随成员资料存 Identity.metadata，不写入 User.email）
      email: (u.errcode === 0 && (u.biz_mail || u.email)) || null,
      avatarUrl: u.errcode === 0 ? (u.thumb_avatar ?? u.avatar ?? null) : null,
      metadata: { corpId: this.cfg.corpId, status: u.status },
    };
  }

  // ── access_token 集中管理：7200s 缓存 + 并发收敛（企微重复获取会互踢旧 token）──
  // 注意：供同文件的 Channel 复用，勿在类外直接调用
  private tokenCache: { token: string; expiresAt: number } | null = null;
  private tokenPromise: Promise<string> | null = null;

  async getAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt)
      return this.tokenCache.token;
    if (this.tokenPromise) return this.tokenPromise; // 并发请求等待同一次刷新
    this.tokenPromise = (async () => {
      const res = await fetch(
        `${API}/gettoken?corpid=${encodeURIComponent(this.cfg.corpId)}&corpsecret=${encodeURIComponent(this.cfg.secret)}`,
      );
      const data = (await res.json()) as {
        errcode: number;
        errmsg?: string;
        access_token?: string;
        expires_in?: number;
      };
      if (data.errcode !== 0 || !data.access_token) {
        throw new HttpError(502, "errors.wecomCredentialFailed", undefined, {
          errcode: data.errcode,
          errmsg: data.errmsg ?? "",
        });
      }
      // 提前 5 分钟过期，避免边界失效
      this.tokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + ((data.expires_in ?? 7200) - 300) * 1000,
      };
      return data.access_token;
    })();
    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = null;
    }
  }

  /**
   * 使缓存 token 失效（token 被外部互踢 / 运营后台重置 secret 时调用），
   * 下次 getAccessToken 强制重取。Channel 发送遇到 token 失效类 errcode 时自愈用。
   */
  invalidateAccessToken(): void {
    this.tokenCache = null;
  }
}

/** M4 通知通道：应用消息 textcard（标题+摘要+跳转链接） */
export class WecomRealChannel implements ImNotificationChannel {
  id = "WECOM" as const;
  mode = "real" as const;

  constructor(
    private provider: WecomRealProvider,
    private cfg: { agentId: string },
  ) {}

  async sendToUser(
    providerUserId: string,
    message: ImMessage,
    locale?: Locale,
  ): Promise<void> {
    const send = async () => {
      const token = await this.provider.getAccessToken();
      const res = await fetch(
        `${API}/message/send?access_token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            touser: providerUserId,
            msgtype: "textcard",
            agentid: Number(this.cfg.agentId),
            textcard: {
              title: truncateUtf8(message.title, 128),
              description: truncateUtf8(message.summary, 512),
              url: message.url,
              btntxt: translatorFor(locale ?? "en")("im.openButtonText"),
            },
          }),
        },
      );
      return (await res.json()) as { errcode: number; errmsg?: string };
    };
    let data = await send();
    // token 失效自愈：40014/42001 = access_token 硬过期或被新 token 互踢，
    // 清缓存重取一次再试；仍失败才让 job 进入 pg-boss 重试
    if (data.errcode === 40014 || data.errcode === 42001) {
      this.provider.invalidateAccessToken();
      data = await send();
    }
    if (data.errcode !== 0) {
      throw new Error(`企微消息发送失败: ${data.errcode} ${data.errmsg ?? ""}`);
    }
  }
}
