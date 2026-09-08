import { getUserContext } from "@/server/auth/pages";
import Workbench from "@/components/workbench/Workbench";
import WorkbenchCards from "@/components/account/WorkbenchCards";

export const dynamic = "force-dynamic";

// 账号壳首页（登录落地页）：计数卡阵列 → Workbench 三 tab。
// 身份锚点已按用户要求移除：账号服务在顶栏账号菜单，页面不再重复展示。
// ?ws=<slug>：收窄到单一工作区的任务汇总——slug 须为该用户的工作区，
// 否则忽略（不泄露他人的工作区存在性）。
export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string; tab?: string }>;
}) {
  const { workspaces } = await getUserContext();
  const { ws, tab } = await searchParams;
  const activeWs = ws ? workspaces.find((w) => w.slug === ws) : undefined;
  // 计数卡深链 /me?tab=<key> 的消费方；非法值回退默认 tab（不报错）
  const initialTab =
    tab === "created" || tab === "notifications" ? tab : "assigned";

  return (
    <div className="px-8 py-6">
      {!activeWs && (
        <div className="mb-6">
          <WorkbenchCards />
        </div>
      )}

      <Workbench
        wsScope={activeWs?.slug ?? null}
        wsName={activeWs?.name ?? null}
        initialTab={initialTab}
      />
    </div>
  );
}
