import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";

// U1.6：404 品牌页（替换 Next 默认英文页）

export default async function NotFound() {
  const t = await getTranslations("auth");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <FileQuestion className="size-10 text-muted-foreground/50" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">{t("notFoundTitle")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("notFoundDescription")}
      </p>
      <Button asChild className="mt-2">
        <Link href="/">{t("backToWorkspace")}</Link>
      </Button>
    </main>
  );
}
