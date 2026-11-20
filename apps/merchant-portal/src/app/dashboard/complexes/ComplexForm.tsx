"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";
import { createComplex, type ComplexFormState } from "@/lib/actions";

const inputClass =
  "w-full bg-[#0f172a] border border-slate-700 focus:border-amber-500 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 outline-none transition-colors";

function Field({
  name,
  label,
  hint,
  error,
  ...input
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-400 mb-1.5">{label}</span>
      <input name={name} className={inputClass} aria-invalid={Boolean(error)} {...input} />
      {error ? (
        <span role="alert" className="block text-xs text-red-400 mt-1">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-slate-500 mt-1">{hint}</span>
      ) : null}
    </label>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-900 font-semibold text-sm rounded-lg px-4 py-2.5 transition-colors"
    >
      <Plus size={16} />
      {pending ? "Adding…" : "Add complex"}
    </button>
  );
}

/** The admin's "new shopping complex" form. Every field is checked again on the server. */
export function ComplexForm() {
  const [state, action] = useActionState<ComplexFormState, FormData>(createComplex, {});
  const errors = state.errors ?? {};

  return (
    <form action={action} className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field name="name" label="Name" placeholder="e.g. Junction Plaza" required error={errors.name} />
      <Field name="address" label="Street address" placeholder="1 Main Road, Town" required error={errors.address} />
      <Field
        name="lat"
        label="Latitude"
        inputMode="decimal"
        placeholder="-24.6"
        required
        error={errors.lat}
        hint="Negative in South Africa. Copy it from the complex's pin on a map."
      />
      <Field name="lng" label="Longitude" inputMode="decimal" placeholder="29.9" required error={errors.lng} />
      <Field
        name="deliveryRadiusKm"
        label="Delivery radius (km)"
        inputMode="decimal"
        defaultValue="8"
        required
        error={errors.deliveryRadiusKm}
        hint="Orders further than this from the complex are refused at checkout."
      />
      <Field
        name="deliveryFee"
        label="Delivery fee (R)"
        inputMode="decimal"
        defaultValue="20"
        required
        error={errors.deliveryFee}
        hint="What a customer pays for delivery from any store in the complex."
      />
      <div className="md:col-span-2 flex items-center gap-4">
        <Submit />
        {state.ok && <span className="text-sm text-emerald-400">Complex added.</span>}
        {state.error && (
          <span role="alert" className="text-sm text-red-400">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
