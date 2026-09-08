import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getWecomProvider } from "@/server/im/wecom";
import MockLoginPanel from "./login-panel";

export const dynamic = "force-dynamic";

// 服务端守卫：mock 通道关闭（真实凭证/生产默认）即 404——与 /mock/wecom-inbox 同口径。
// 只靠 /api/auth/mock/users 403 兜底时外壳仍会渲染，守卫上移到页面层
export default async function WecomMockLoginPage() {
  const provider = await getWecomProvider();
  if (!provider || provider.mode !== "mock") notFound();
  const t = await getTranslations("common");
  return (
    <Suspense fallback={<div className="p-10 text-sm text-muted-foreground">{t("loading")}</div>}>
      <MockLoginPanel />
    </Suspense>
  );
}
