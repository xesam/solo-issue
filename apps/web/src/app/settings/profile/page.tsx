import { redirect } from "next/navigation";

// 旧「个人信息」分区已并入「账号」（/settings/account），此处保留跳转兼容旧入口。
export default function ProfilePage() {
  redirect("/settings/account");
}
