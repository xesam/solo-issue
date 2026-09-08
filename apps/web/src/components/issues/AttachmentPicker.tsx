"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Plus, X } from "lucide-react";

// 附件宫格（创建/编辑共用）：统一的方格缩略图 + 末尾「+」格入口。
//
// 两种模式（格子形态一致，区别仅在数据语义）：
// - 暂存（创建页）：传 files + onFilesChange，选中文件先留本地（宫格内用
//   objectURL 预览，创建成功后页面补传），逐格移除、同名同大小去重
// - 立即（编辑页）：传 onUpload，选中即上传；已传部分由页面以 children
//   注入（AttachmentTile 的 <li> 列表，渲染在暂存格与「+」格之前）
//
// AttachmentTile 由本文件导出，供编辑页渲染已上传附件——两页格子外观
// 不允许各自演化分叉。

export function AttachmentTile({
  name,
  image,
  href,
  onRemove,
}: {
  name: string;
  /** 有值渲染缩略图（已传附件走 /api/attachments/{id}，暂存走 objectURL）；falsy 渲染文件磁贴 */
  image?: string | null;
  /** 点击打开原文件（已传附件）；暂存文件不传 */
  href?: string;
  onRemove: () => void;
}) {
  const t = useTranslations("issues");
  return (
    <li className="relative size-20">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={name}
          title={name}
          className="block size-full overflow-hidden rounded-md border border-border bg-muted"
        >
          <TileContent name={name} image={image} />
        </a>
      ) : (
        <div className="size-full overflow-hidden rounded-md border border-border bg-muted">
          <TileContent name={name} image={image} />
        </div>
      )}
      <button
        type="button"
        aria-label={t("removeAttachment", { name })}
        onClick={onRemove}
        className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm hover:text-destructive"
      >
        <X className="size-3" aria-hidden />
      </button>
    </li>
  );
}

function TileContent({ name, image }: { name: string; image?: string | null }) {
  return image ? (
    // 鉴权同源对象流 / 本地 objectURL，不走 next/image 优化管线
    <img src={image} alt={name} loading="lazy" className="size-full object-cover" />
  ) : (
    <div className="flex size-full flex-col items-center justify-center gap-0.5 px-1.5 text-center">
      <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="w-full truncate text-xs text-muted-foreground" title={name}>
        {name}
      </span>
    </div>
  );
}

/** 暂存文件格：本地 File 的 objectURL 预览（随格挂载创建 / 卸载回收） */
function StagedTile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const isImage = file.type.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, isImage]);
  return <AttachmentTile name={file.name} image={url} onRemove={onRemove} />;
}

export default function AttachmentPicker({
  files,
  onFilesChange,
  onUpload,
  children,
}: {
  files?: File[];
  onFilesChange?: (files: File[]) => void;
  onUpload?: (files: File[]) => void;
  /** 已上传附件格（AttachmentTile 的 <li> 列表，编辑页注入，渲染在暂存格与「+」格之前） */
  children?: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useTranslations("issues");
  const addLabel = t("uploadAttachment");
  const staged = !!(files && onFilesChange);

  function handlePicked(picked: File[]) {
    if (staged) {
      // 去重：同名同大小视为同一文件——存量与同批内部都要查
      // （file input 同一次多选可含重复；只对存量过滤会让同批重复一起进暂存）
      const batch: File[] = [];
      for (const f of picked) {
        const dup = [...files!, ...batch].some(
          (p) => p.name === f.name && p.size === f.size,
        );
        if (!dup) batch.push(f);
      }
      onFilesChange!([...files!, ...batch]);
    } else {
      onUpload?.(picked);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          handlePicked(Array.from(e.target.files ?? []));
          e.target.value = ""; // 允许重复选同名文件
        }}
      />
      <ul className="flex flex-wrap gap-1.5">
        {children}
        {staged &&
          files!.map((f, i) => (
            <StagedTile
              key={`${f.name}-${f.size}-${i}`}
              file={f}
              onRemove={() => onFilesChange!(files!.filter((_, j) => j !== i))}
            />
          ))}
        <li className="size-20">
          <button
            type="button"
            aria-label={addLabel}
            onClick={() => inputRef.current?.click()}
            className="flex size-full items-center justify-center rounded-md border border-dashed border-input text-muted-foreground transition-colors hover:border-ring hover:text-primary"
          >
            <Plus className="size-5" aria-hidden />
          </button>
        </li>
      </ul>
    </div>
  );
}
