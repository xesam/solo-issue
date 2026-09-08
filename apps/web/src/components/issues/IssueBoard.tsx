"use client";

import type { State } from "@prisma/client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { IssueDTO, IssueListResult } from "@/lib/dto";
import {
  apiPatch,
  useInvalidateIssue,
  useMutation,
  useQueryClient,
} from "@/lib/client/api";
import { Avatar } from "@/components/ui/bits";
import { toast } from "sonner";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";

function Card({ issue, link }: { issue: IssueDTO; link: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: issue.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={`mb-2 cursor-grab rounded-xl border bg-card p-3 shadow-sm active:cursor-grabbing ${
        isDragging
          ? // 拖拽中 transform 每帧更新，禁用其 transition——否则缓动补间让卡片滞后于指针（dnd-kit 经典坑）
            "z-10 rotate-1 border-ring opacity-90 shadow-lg transition-[opacity,box-shadow]"
          : "border-border transition-[transform,opacity,box-shadow]"
      }`}
    >
      <Link href={link} className="block text-sm font-medium transition-colors hover:text-primary">
        {issue.title}
      </Link>
      <div className="mt-2 flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground/70">#{issue.number}</span>
        <div className="flex items-center gap-1.5">
          {issue.assignees.slice(0, 2).map((a) => (
            <Avatar key={a.user.id} user={a.user} size={20} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Column({
  state,
  issues,
  makeLink,
}: {
  state: State;
  issues: IssueDTO[];
  makeLink: (i: IssueDTO) => string;
}) {
  const t = useTranslations("issues");
  const { setNodeRef, isOver } = useDroppable({ id: state.id });
  return (
    <div className="flex w-64 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: state.color }} />
          {state.name}
        </span>
        <span className="text-xs text-muted-foreground/70">{issues.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`min-h-48 flex-1 rounded-xl bg-muted/60 p-2 ring-2 ring-inset ${
          isOver ? "ring-primary/40" : "ring-transparent"
        }`}
      >
        {issues.map((i) => (
          <Card key={i.id} issue={i} link={makeLink(i)} />
        ))}
        {!issues.length && (
          <p className="py-6 text-center text-xs text-muted-foreground/50">{t("dragCardHere")}</p>
        )}
      </div>
    </div>
  );
}

export default function IssueBoard({
  issues,
  states,
  projectId,
  wsSlug,
  projectSlug,
}: {
  issues: IssueDTO[];
  states: State[];
  projectId: string;
  wsSlug: string;
  projectSlug: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const qc = useQueryClient();
  const invalidate = useInvalidateIssue(projectId);
  const t = useTranslations("issues");
  const makeLink = (i: IssueDTO) =>
    `/w/${wsSlug}/p/${projectSlug}/issues/${i.number}`;

  const move = useMutation({
    mutationFn: (v: { number: number; stateId: string }) =>
      apiPatch(`/api/projects/${projectId}/issues/${v.number}`, { stateId: v.stateId }),
    // 分页响应缓存是 {issues,total,page,pageSize} 信封而非裸数组——
    // 旧代码按裸数组 data.map() 直接抛错，onMutate 一抛 mutation 即中止
    // （PATCH 根本不发出、也无任何报错），表现即“看板无法在状态列间移动”。
    // 按信封只更新内层 issues；total 不变（同一条记录移动，不增不减）。
    onMutate: async ({ number, stateId }) => {
      const prev = qc.getQueriesData<IssueListResult>({ queryKey: ["issues", projectId] });
      prev.forEach(([key, data]) => {
        if (!data) return;
        qc.setQueryData(key, {
          ...data,
          issues: data.issues.map((i) =>
            i.number === number
              ? { ...i, stateId, state: states.find((s) => s.id === stateId) ?? i.state }
              : i,
          ),
        });
      });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data));
      // 静默回退会把权限/网络失败伪装成“拖不动”——报真实原因（ui-guidelines §2：系统错误 toast.error）
      toast.error(e instanceof Error ? e.message : t("moveFailed"));
    },
    onSettled: () => invalidate(),
  });

  // 拖拽结束后浏览器会合成一次 click，而“跟手的卡片”正落在指针下——合成 click 会命中
  // 标题 <a> 的默认导航，把用户劫持到详情页。dnd-kit 6.3.1 自带的 document capture
  // click 监听只 stopPropagation 不 preventDefault（链接默认导航不被取消），且其
  // stopPropagation 发生在 React 合成事件之前，React 层拦不到——只能在原生层吞：
  // onDragEnd 时挂一次性 capture 监听 preventDefault，50ms 兜底自清
  // （物理上人不可能在松手后 50ms 内再点一次，不影响正常点击）。
  function suppressNextClick() {
    const cleanup = () => {
      document.removeEventListener("click", handler, true);
      clearTimeout(timer);
    };
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    };
    document.addEventListener("click", handler, true);
    const timer = setTimeout(cleanup, 50);
  }

  function onDragEnd(e: DragEndEvent) {
    suppressNextClick();
    if (!e.over) return;
    const issue = issues.find((i) => i.id === String(e.active.id));
    if (!issue || issue.stateId === e.over.id) return;
    move.mutate({ number: issue.number, stateId: String(e.over.id) });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragEnd={onDragEnd}
      onDragCancel={suppressNextClick}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {states.map((s) => (
          <Column
            key={s.id}
            state={s}
            issues={issues.filter((i) => i.stateId === s.id)}
            makeLink={makeLink}
          />
        ))}
      </div>
    </DndContext>
  );
}
