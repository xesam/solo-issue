import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";
import Providers from "@/components/providers";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("title"), description: t("description") };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {/* U2.6：next-themes 类名模式；suppressHydrationWarning 免首帧类名不一致报错 */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {/* next-intl：messages 下发客户端（useTranslations 全站可用）；locale 随请求协商 */}
          <NextIntlClientProvider>
            <Providers>{children}</Providers>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
