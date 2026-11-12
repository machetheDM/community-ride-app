"use client";

import { useState, useTransition } from "react";
import { setStoreComplex } from "@/lib/actions";

/**
 * Moves a store into a complex, or out of all of them. The choice is shown only
 * once the server has accepted it: a store's complex decides what its customers
 * pay for delivery, so the page must never show a fee the store is not charging.
 */
export function StoreComplexSelect({
  storeId,
  current,
  complexes,
}: {
  storeId: string;
  current: string | null;
  complexes: { id: string; name: string }[];
}) {
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const change = (next: string) => {
    setError(null);
    startTransition(async () => {
      const result = await setStoreComplex(storeId, next === "" ? null : next);
      if ("error" in result) setError(result.error);
      else setValue(next);
    });
  };

  return (
    <div>
      <select
        value={value}
        disabled={isPending}
        onChange={(e) => change(e.target.value)}
        aria-label="Shopping complex"
        className="bg-[#0f172a] border border-slate-700 focus:border-amber-500 rounded-lg px-2 py-1.5 text-sm text-slate-100 outline-none disabled:opacity-60"
      >
        <option value="">Stand-alone</option>
        {complexes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {error && (
        <p role="alert" className="text-xs text-red-400 mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
