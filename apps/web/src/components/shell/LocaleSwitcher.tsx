"use client";

// 语言切换菜单（顶栏头像菜单内，与「外观」同级的偏好子菜单）：
// 写 NEXT_LOCALE cookie → router.refresh() 让服务端按新 locale 重渲。
// 不入库（B 决策）：换设备新协商，无跨设备同步

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import { apiPost } from "@/lib/client/api";
import { LOCALES, type Locale } from "@/i18n/config";
import { toast } from "sonner";
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

export default function LocaleSwitcher() {
  const t = useTranslations("language");
  const locale = useLocale() as Locale;
  const router = useRouter();

  async function switchTo(next: string) {
    if (next === locale || !LOCALES.includes(next as Locale)) return;
    try {
      await apiPost("/api/locale", { locale: next });
      router.refresh();
    } catch {
      toast.error(t("switchFailed"));
    }
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="text-sm">
        <Languages className="size-4" aria-hidden />
        {t("label")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={locale} onValueChange={(v) => void switchTo(v)}>
          {LOCALES.map((l) => (
            <DropdownMenuRadioItem key={l} value={l} className="text-sm">
              {t(l)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
