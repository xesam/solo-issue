"use client";

import type { CustomFieldDTO, MemberDTO } from "@/lib/client/api";
import CustomFieldInput, { type FieldValues } from "@/components/issues/CustomFieldInput";

// 动态字段区（无字段时不渲染，保持既有表单视觉不变）
export default function CustomFieldsSection({
  fields,
  values,
  onChange,
  members,
}: {
  fields: CustomFieldDTO[] | undefined;
  values: FieldValues;
  onChange: (key: string, value: string | number | string[] | null) => void;
  members?: MemberDTO[] | undefined;
}) {
  if (!fields?.length) return null;
  return (
    <div className="grid grid-cols-1 gap-3">
      {fields.map((f) => (
        <CustomFieldInput
          key={f.id}
          field={f}
          value={values[f.key] ?? null}
          onChange={(v) => onChange(f.key, v)}
          members={members}
        />
      ))}
    </div>
  );
}
