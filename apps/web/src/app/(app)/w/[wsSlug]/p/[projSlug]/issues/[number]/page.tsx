import { notFound } from "next/navigation";
import { parseIssueNumber } from "@/lib/api";
import { pageProject } from "@/server/auth/pages";
import { ISSUE_INCLUDE } from "@/lib/dto";
import { prisma } from "@/lib/prisma";
import IssueDetail from "@/components/issues/IssueDetail";

export const dynamic = "force-dynamic";

export default async function IssuePage({
  params,
}: {
  params: Promise<{ wsSlug: string; projSlug: string; number: string }>;
}) {
  const { wsSlug, projSlug, number: numberStr } = await params;
  const { project } = await pageProject(wsSlug, projSlug);

  const number = parseIssueNumber(numberStr);
  if (number === null) notFound();

  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId: project.id, number } },
    include: ISSUE_INCLUDE,
  });
  if (!issue) notFound();

  return (
    <IssueDetail
      wsSlug={wsSlug}
      projectSlug={projSlug}
      projectName={project.name}
      projectId={project.id}
      projectIsPrivate={project.isPrivate}
      number={number}
      initialIssue={issue}
    />
  );
}
