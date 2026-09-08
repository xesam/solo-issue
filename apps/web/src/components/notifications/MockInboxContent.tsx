"use client";

import { useQuery } from "@tanstack/react-query";
import type { MockMessage } from "@prisma/client";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/client/api";
import { fmtDateTime } from "@/components/ui/bits";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// 模拟收件箱：验证企微推送文案/去重/频控的可视化工具（仅 mock 模式）

export default function MockInboxContent() {
  const t = useTranslations("notifications");
  const { data, error } = useQuery({
    queryKey: ["mock-messages"],
    queryFn: () => apiGet<MockMessage[]>("/api/mock/messages"),
    refetchInterval: 5_000,
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-xs font-medium uppercase tracking-wide text-warning-text">
        {t("envBadge")}
      </p>
      <h1 className="mb-1 mt-1 text-xl font-semibold">{t("title")}</h1>
      <p className="mb-8 text-xs text-muted-foreground">
        {t("desc")}
      </p>

      {error instanceof Error && (
        <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error.message}</p>
      )}

      <ol className="space-y-4">
        {/* ol 的直接子节点必须是 li——Card 是 div，包一层 li 保持合法列表 DOM */}
        {data?.map((m) => (
          <li key={m.id}>
          <Card>
            <CardContent className="p-4">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground/70">
                <Badge variant="outline" className="border-success-subtle bg-success-subtle font-medium text-success-text">
                  {t("wecomBadge", { user: m.toUser })}
                </Badge>
                <span>{fmtDateTime(m.createdAt)}</span>
              </div>
              <p className="text-sm font-medium text-foreground/90">{m.title}</p>
              {m.summary && <p className="mt-1 text-xs text-muted-foreground">{m.summary}</p>}
              <a
                href={m.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-primary hover:underline"
              >
                {m.url}
              </a>
            </CardContent>
          </Card>
          </li>
        ))}
        {data?.length === 0 && (
          <li className="rounded-xl bg-muted/50 p-6 text-center text-sm text-muted-foreground">
            {t("empty")}
          </li>
        )}
      </ol>
    </main>
  );
}
