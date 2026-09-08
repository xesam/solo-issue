"use client";

import { TriangleAlert, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

// U1.6：全局错误兜底页（dev 显示详情，prod 显示通用文案 + 重试）

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <TriangleAlert className="size-10 text-muted-foreground/50" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">{t("errorTitle")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("errorDescription")}
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground/60">
          {t("errorDigest", { digest: error.digest })}
        </p>
      )}
      <Button variant="outline" onClick={reset} className="mt-2">
        <RotateCcw className="size-4" />
        {tCommon("retry")}
      </Button>
    </main>
  );
}
