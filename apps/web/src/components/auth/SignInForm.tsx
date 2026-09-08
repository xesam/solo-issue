"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet, apiPost } from "@/lib/client/api";
import { withBase } from "@/lib/base-path";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LogoFull } from "@/components/ui/logo";
import { TriangleAlert } from "lucide-react";

type Providers = {
  wecom: {
    enabled: boolean;
    mode: "real" | "mock" | null;
    flows: readonly ("in-app" | "web")[];
  };
};

function SignInInner() {
  // 不使用 useSearchParams——它会让整页 bail out 到客户端渲染，
  // JS 加载失败时用户只能看到一行"加载中…"。error 参数只在登录失败跳回时
  // 存在，客户端 useEffect 里读 window.location 即可。
  const [urlError, setUrlError] = useState<string | null>(null);
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<Providers | null>(null);
  // 企微内（WebView）还是系统浏览器：决定走静默授权还是 Web 扫码登录。
  // 初始 false 避免与 SSR 输出不一致，客户端 effect 中再修正
  const [isInWeCom, setIsInWeCom] = useState(false);

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) setUrlError(err);
    setIsInWeCom(/wxwork/i.test(navigator.userAgent));
    apiGet<Providers>("/api/auth/providers")
      .then(setProviders)
      .catch(() => {
        // 探测失败不阻塞密码登录——企微按钮隐藏即可，静默是刻意的
      });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiPost<{ user: { mustChangePassword: boolean } }>(
        "/api/auth/login",
        { email, password },
      );
      window.location.href = res.user.mustChangePassword
        ? withBase("/change-password")
        : withBase("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loginFailed"));
      setLoading(false);
    }
  }
  const wecomEnabled = providers?.wecom.enabled;
  const wecomMock = providers?.wecom.mode === "mock";
  const wecomFlows = providers?.wecom.flows ?? [];
  // 能力（服务端 flows）× 环境（UA）：企微内走静默授权按钮；
  // 系统浏览器且服务端声明支持 web 流程时走扫码入口；否则保留原按钮
  // （点击后由 start 的 UA 护栏引导回企微打开）
  const hasWebFlow = wecomFlows.includes("web");
  const useWebEntry = wecomEnabled && !isInWeCom && hasWebFlow;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="flex justify-center">
            <LogoFull className="h-10" />
            <span className="sr-only">Solo Issue</span>
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">{t("tagline")}</p>
        </div>

        <Card className="shadow-sm">
          <CardContent className="space-y-4 p-6">
            {wecomEnabled && (
              // 企微品牌绿为品牌例外色（见 docs/07-ui-guidelines.md）
              <Button asChild className="w-full bg-success hover:bg-success/90">
                <a href={withBase(useWebEntry ? "/api/auth/wecom/web-start" : "/api/auth/wecom/start")}>
                  {wecomMock
                    ? t("wecomLoginMock")
                    : useWebEntry
                      ? t("wecomScanLogin")
                      : t("wecomLogin")}
                </a>
              </Button>
            )}

            {wecomEnabled && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
                <span className="h-px flex-1 bg-border" />
                {t("orDivider")}
                <span className="h-px flex-1 bg-border" />
              </div>
            )}

            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="email">{t("email")}</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">{t("password")}</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              {(error || urlError) && (
                <Alert variant="destructive" className="py-2">
                  <TriangleAlert className="size-4" />
                  <AlertDescription>{error || urlError}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("signingIn") : t("signIn")}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground/60">
          {t("noAccountHint")}
        </p>
      </div>
    </main>
  );
}

export default function SignInForm() {
  return (
    <SignInInner />
  );
}
