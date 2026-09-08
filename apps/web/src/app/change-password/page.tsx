import { Suspense } from "react";
import { getSessionUser } from "@/server/auth/session";
import { redirect } from "next/navigation";
import ChangePasswordForm from "@/components/auth/ChangePasswordForm";
import { Skeleton } from "@/components/ui/skeleton";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  // 自助改密并入设置页；此路由仅保留首登强制改密流程
  if (!user.mustChangePassword) redirect("/settings/account");

  return (
    <Suspense
      fallback={
        <div className="space-y-4 p-10">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-10 w-full max-w-sm" />
          <Skeleton className="h-10 w-full max-w-sm" />
          <Skeleton className="h-9 w-24" />
        </div>
      }
    >
      <ChangePasswordForm forced={user.mustChangePassword} />
    </Suspense>
  );
}
