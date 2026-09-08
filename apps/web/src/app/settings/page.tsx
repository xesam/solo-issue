import { redirect } from "next/navigation";

// /settings 裸路径直达账号分区
export default function SettingsIndexPage() {
  redirect("/settings/account");
}
