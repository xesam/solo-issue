"use client";

import { useTranslations } from "next-intl";
import ApiTokensPanel from "@/components/settings/ApiTokensPanel";
import CreateTokenDialog from "@/components/settings/CreateTokenDialog";
import PageHeader from "@/components/shell/PageHeader";

// API 令牌分区（原 AccountSettings「API 令牌」Section 内嵌面板升格）。
// 创建/重命名/撤销一律走 Dialog 交互（与建号等全局范式一致，弃页内内联表单）；
// 内容容器全宽铺满剩余宽度（ui-guidelines §7：去 mx-auto max-w-*，与管理台页面同宽不跳动）。
export default function TokensPage() {
  const t = useTranslations("settings");
  return (
    <div className="px-8 py-6">
      <PageHeader title={t("apiTokens")}>
        <CreateTokenDialog />
      </PageHeader>
      <div className="mt-4">
        <ApiTokensPanel />
      </div>
    </div>
  );
}
