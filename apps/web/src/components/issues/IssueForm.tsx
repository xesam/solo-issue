"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import type { State } from "@prisma/client";
import type { CustomFieldDTO } from "@/lib/client/api";
import type { JSONContent } from "@tiptap/core";
import RichEditor from "@/components/editor/RichEditor";
import MemberCombobox from "@/components/members/MemberCombobox";
import CustomFieldsSection from "@/components/issues/CustomFieldsSection";
import IssueStateSelect from "@/components/issues/IssueStateSelect";
import AttachmentPicker from "@/components/issues/AttachmentPicker";
import type { MemberDTO } from "@/lib/client/api";
import type { FieldValues } from "@/components/issues/CustomFieldInput";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TriangleAlert } from "lucide-react";

// 问题表单（创建/编辑统一大组件）：
// 「新建问题」与「编辑问题」共用同一套 UI/UX——标题、描述、属性区、附件区、
// 底部操作栏的布局与交互全部在此定义，两页不允许再各自演化出分叉的外观。
//
// 架构约定：
// - 受控组件：字段状态由页面持有（编辑页需要快照 diff + 轮询防回写），表单只管
//   布局与交互，通过 values/onChange 与页面通信
// - IO 全部在页面：提交/上传/校验都是页面职责，表单通过 onSubmit/onPickFiles 回调
//
// 键盘语义（两页一致，实现在组件内 handleKeyDown）：
// - 裸 Enter（标题/自定义字段等单行输入内）→ 焦点送去描述区，不提交
// - ⌘/Ctrl+Enter → 提交（onSubmit）
//
// 附件宫格（两页一致）：属性区末尾的同一位置，统一的方格缩略图 + 末尾「+」格
// 单一入口（AttachmentPicker）。区别仅在数据语义——创建页选中的文件进
// stagedFiles 暂存（objectURL 预览、逐格移除，创建成功后页面补传）；
// 编辑页选中即调 onPickFiles 上传，已传格列表由 attachments 插槽注入宫格头部。

export interface IssueFormValues {
  title: string;
  descDoc: JSONContent | null;
  /** stateId；"" = 无状态 */
  stateId: string;
  assigneeIds: string[];
  fieldValues: FieldValues;
  /** 创建模式暂存附件；编辑模式恒为 [] */
  stagedFiles: File[];
}

export default function IssueForm({
  values,
  onChange,
  states,
  stateValue,
  showNone,
  members,
  knownUsers,
  customFields,
  descPlaceholder,
  titleAutofocus = false,
  onUploadImage,
  onPickFiles,
  attachments,
  error,
  dirty,
  primary,
  secondary,
  onSubmit,
}: {
  values: IssueFormValues;
  onChange: (patch: Partial<IssueFormValues>) => void;
  states: State[] | undefined;
  /** 状态下拉的显示值（创建页传入 stateId||defaultStateId；编辑页直接传 stateId） */
  stateValue: string;
  /** 是否显示「无状态」项 */
  showNone: boolean;
  members: MemberDTO[] | undefined;
  /** 编辑页：已选成员的本地快照（成员查询未返回时先渲染 chips，避免首屏竞态丢失） */
  knownUsers?: { id: string; name: string; email?: string | null; avatarUrl?: string | null }[];
  customFields: CustomFieldDTO[] | undefined;
  descPlaceholder: string;
  titleAutofocus?: boolean;
  /** 编辑页：描述里粘贴图片的上传回调；创建页不传（图片需 issue 存在） */
  onUploadImage?: (file: File) => Promise<string>;
  /** 编辑页：选中附件立即上传；创建页不传 → 进 stagedFiles 暂存 */
  onPickFiles?: (files: File[]) => void;
  /** 编辑页：已上传附件格列表（AttachmentTile，注入附件宫格头部） */
  attachments?: React.ReactNode;
  error: string | null;
  /** 编辑页：脏状态（控制「未保存」徽标）；创建页不传（恒有输入，徽标无意义） */
  dirty?: boolean;
  onSubmit: () => void;
  /** 操作栏主按钮组（左：创建/保存；「并返回」变体由页面以 fragment 并列注入） */
  primary: React.ReactNode;
  /** 操作栏次要按钮（右对齐：创建页=取消；编辑页=归档/删除/取消） */
  secondary?: React.ReactNode;
}) {
  const t = useTranslations("issues");
  const descRef = useRef<HTMLDivElement>(null);
  function focusDesc() {
    (descRef.current?.querySelector(".rich-content") as HTMLElement | null)?.focus();
  }

  // 键盘语义在 keydown 层兑现（onSubmit 已经分辨不出裸 Enter——隐式提交派发的
  // submit 事件 nativeEvent 是 SubmitEvent、非 KeyboardEvent，事后判别不可靠）：
  // - ⌘/Ctrl+Enter → 提交
  // - 裸 Enter（标题/自定义字段等单行输入内）→ 焦点送去描述区，不提交
  // - 弹层检索框（cmdk）内 → 只拦隐式提交兜底，不抢弹层的 Enter 选中语义
  // - date 输入不拦：保留原生日历弹层的键盘开合路径
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    // IME 组合态的 Enter 是「上屏」不是「提交」——抢走会把焦点意外送到描述区
    if (e.nativeEvent.isComposing) return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      onSubmit();
      return;
    }
    const el = e.target as HTMLElement;
    if (el.closest("[cmdk-root]")) {
      e.preventDefault();
      return;
    }
    const type = (el as HTMLInputElement).type;
    if (
      el.tagName === "INPUT" &&
      !["button", "checkbox", "date", "file", "radio", "reset", "submit", "hidden"].includes(type)
    ) {
      e.preventDefault();
      focusDesc();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    // 提交只剩按钮点击与 ⌘/Ctrl+Enter 两条正路——裸 Enter 已在 keydown 层拦截
    e.preventDefault();
    onSubmit();
  }

  const memberOptions = (members ?? []).map((m) => ({
    id: m.user.id,
    label: m.user.name,
    email: m.user.email,
    origin: m.user.origin, // 候选凭据标识：IM 账号显来源、邮箱账号显邮箱，重名可辨
  }));

  return (
    <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="flex flex-col gap-6">
      {/* 标题：文档式输入，非表单框 */}
      <input
        value={values.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder={t("titlePlaceholder")}
        autoFocus={titleAutofocus}
        aria-required="true"
        aria-invalid={!values.title.trim()}
        className="w-full bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/40"
      />

      <div ref={descRef}>
        <RichEditor
          doc={values.descDoc ?? undefined}
          onUpdate={(doc) => onChange({ descDoc: doc })}
          members={memberOptions}
          placeholder={descPlaceholder}
          onUploadImage={onUploadImage}
        />
      </div>

      {/* 属性区：编辑器正下方，字段改动与提交动作同屏 */}
      <section>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("state")}</label>
            <div className="w-2/3">
              <IssueStateSelect
                size="default"
                states={states}
                value={stateValue}
                onChange={(stateId) => onChange({ stateId })}
                showNone={showNone}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("assignees")}</label>
          <div className="w-2/3">
            <MemberCombobox
              members={members}
              knownUsers={knownUsers}
              selected={values.assigneeIds}
              onChange={(assigneeIds) => onChange({ assigneeIds })}
              variant="staging"
            />
          </div>
          </div>
        </div>

        {customFields?.length ? (
          <div className="mt-3">
            <CustomFieldsSection
              fields={customFields}
              values={values.fieldValues}
              onChange={(key, v) =>
                onChange({ fieldValues: { ...values.fieldValues, [key]: v } })
              }
              members={members}
            />
          </div>
        ) : null}

        {/* 附件宫格：两页同一位置、同一「+」格入口 */}
        <fieldset className="mt-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("attachmentsLabel")}</label>
            <AttachmentPicker
              onUpload={onPickFiles}
              files={onPickFiles ? undefined : values.stagedFiles}
              onFilesChange={
                onPickFiles ? undefined : (stagedFiles) => onChange({ stagedFiles })
              }
            >
              {attachments}
            </AttachmentPicker>
          </div>
        </fieldset>
      </section>

      {error ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* 底部操作栏（两页同构）：主按钮居左（未保存徽标随右），次要操作右对齐。
          只 sticky 主栏（右栏有自己的底部输入框，横跨会打架） */}
      <div className="sticky bottom-0 -mx-2 flex items-center gap-3 border-t border-border bg-background/80 px-2 py-2.5 backdrop-blur">
        {primary}
        {dirty && (
          <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-xs text-warning-text">
            {t("unsaved")}
          </span>
        )}
        {secondary ? <div className="ml-auto flex items-center gap-2">{secondary}</div> : null}
      </div>
    </form>
  );
}
