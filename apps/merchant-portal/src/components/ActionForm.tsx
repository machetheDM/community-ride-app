"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/event-actions";

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "number" | "datetime-local" | "date" | "textarea" | "select" | "checkbox" | "file" | "tel";
  placeholder?: string;
  hint?: string;
  required?: boolean;
  defaultValue?: string;
  options?: { value: string; label: string }[];
  accept?: string;
  /** Spans both columns. */
  wide?: boolean;
}

const inputClass =
  "w-full bg-[#0f172a] border border-slate-700 focus:border-amber-500 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 outline-none transition-colors";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-900 font-semibold text-sm rounded-lg px-4 py-2.5 transition-colors"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

function Field({ field, error }: { field: FieldSpec; error?: string }) {
  const common = {
    name: field.name,
    required: field.required,
    "aria-invalid": Boolean(error),
  };
  let control: React.ReactNode;
  if (field.type === "textarea") {
    control = <textarea {...common} rows={3} placeholder={field.placeholder} defaultValue={field.defaultValue} className={inputClass} />;
  } else if (field.type === "select") {
    control = (
      <select {...common} defaultValue={field.defaultValue ?? ""} className={inputClass}>
        <option value="" disabled>
          Choose…
        </option>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "checkbox") {
    control = (
      <span className="flex items-center gap-2 text-sm text-slate-300">
        <input {...common} type="checkbox" className="accent-amber-500" /> {field.placeholder}
      </span>
    );
  } else {
    control = (
      <input
        {...common}
        type={field.type ?? "text"}
        placeholder={field.placeholder}
        defaultValue={field.defaultValue}
        accept={field.accept}
        inputMode={field.type === "number" ? "decimal" : undefined}
        step={field.type === "number" ? "any" : undefined}
        className={field.type === "file" ? "text-sm text-slate-300" : inputClass}
      />
    );
  }

  return (
    <label className={`block ${field.wide ? "md:col-span-2" : ""}`}>
      <span className="block text-xs font-medium text-slate-400 mb-1.5">{field.label}</span>
      {control}
      {error ? (
        <span role="alert" className="block text-xs text-red-400 mt-1">
          {error}
        </span>
      ) : field.hint ? (
        <span className="block text-xs text-slate-500 mt-1">{field.hint}</span>
      ) : null}
    </label>
  );
}

/**
 * A form posting to a Server Action that answers with FormState: field errors
 * shown under their fields, a general error beside the button, and the form
 * cleared after a success. The action re-checks everything; nothing here is a
 * security boundary.
 */
export function ActionForm({
  action,
  fields,
  hidden,
  submitLabel,
  successMessage = "Saved.",
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  fields: FieldSpec[];
  hidden?: Record<string, string>;
  submitLabel: string;
  successMessage?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state.errors ?? {};

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {fields.map((field) => (
        <Field key={field.name} field={field} error={errors[field.name]} />
      ))}
      <div className="md:col-span-2 flex items-center gap-4">
        <Submit label={submitLabel} />
        {state.ok && <span className="text-sm text-emerald-400">{successMessage}</span>}
        {state.error && (
          <span role="alert" className="text-sm text-red-400">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
