import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

// 入口：已登录 → 账号壳首页 /me；未登录 → 登录页
// 修复历史遗留 bug：原实现取第一个工作区拼 /w/:slug/mine，
// 无任何工作区成员关系时会穿透到 /signin——已登录用户被“登出式”弹回登录页。
export default async function Root() {
  const user = await getSessionUser();
  if (user) redirect("/me");
  redirect("/signin");
}
