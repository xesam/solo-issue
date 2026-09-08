import { getSessionUser } from "@/server/auth/session";
import { getTranslations } from "next-intl/server";
import ChangePasswordCard from "@/components/settings/ChangePasswordCard";
import OtherDevicesRow from "@/components/settings/OtherDevicesRow";
import PageHeader from "@/components/shell/PageHeader";
import { credentialHint, hasPasswordChannel, passwordDisableHint } from "@/lib/origin-labels";

export const dynamic = "force-dynamic";

// 账号分区（UI 需求：原「个人信息」+「安全」中的修改密码合并而成）。
// 修改密码成功后服务端自动吊销其他会话，当前会话保留。
// 内容容器全宽铺满剩余宽度（ui-guidelines §7：去 mx-auto max-w-*，与管理台页面同宽不跳动）。
export default async function AccountPage() {
  const user = await getSessionUser();
  const t = await getTranslations("settings");
  const tLabels = await getTranslations("labels");
  // 口径 A（账号能力级）：无邮箱或无密码 = 无"邮箱+密码"登录通道 → 修改密码前置禁用
  const pwdReady = !!user && hasPasswordChannel(user);
  return (
    <div className="px-8 py-6">
      <PageHeader title={t("account")} />

      <div className="mt-3 flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
          {(user?.name ?? "?").slice(0, 1)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{user?.name}</p>
          {/* 凭据标识：IM 建号显示来源（单通道事实的自我认知），邮箱建号保留 email 文本 */}
          <p className="truncate text-xs text-muted-foreground">
            {(user && credentialHint(tLabels, user)) ?? "—"}
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-6">
        {/* 修改密码：头部条卡片，与项目设置卡片同构；无密码通道账号禁用表单仅留提示 */}
        <section className="rounded-xl border border-border bg-card shadow-sm">
          <div className="rounded-t-xl bg-muted/50 px-4 py-3">
            <p className="text-sm font-medium">{t("changePassword")}</p>
            <p className="text-xs text-muted-foreground">
              {pwdReady
                ? t("passwordReadyHint")
                : t("passwordUnavailable")}
            </p>
          </div>
          <div className="p-4">
            {pwdReady ? (
              <ChangePasswordCard />
            ) : (
              <p className="text-sm text-muted-foreground">
                {user ? passwordDisableHint(tLabels, user) : null}
              </p>
            )}
          </div>
        </section>

        {/* 其他设备：头部条右侧为主操作位点 */}
        <section className="rounded-xl border border-border bg-card shadow-sm">
          <OtherDevicesRow />
        </section>
      </div>
    </div>
  );
}
