import { notFound } from "next/navigation";
import { getWecomProvider } from "@/server/im/wecom";
import MockInboxContent from "@/components/notifications/MockInboxContent";

export const dynamic = "force-dynamic";

export default async function MockInboxPage() {
  const provider = await getWecomProvider();
  if (!provider || provider.mode !== "mock") notFound();
  return <MockInboxContent />;
}
