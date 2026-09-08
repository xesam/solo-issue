import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// /admin 顶层只做重定向到默认分区（概览页/统计卡片可后续补充，此处不抢跑）。
// 守卫见 layout.tsx。

export default function AdminPage() {
  redirect("/admin/users");
}
