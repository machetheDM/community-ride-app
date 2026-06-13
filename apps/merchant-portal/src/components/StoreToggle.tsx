"use client";

import { useState, useTransition } from "react";
import { toggleStoreOpen } from "@/lib/actions";

export function StoreToggle({ storeId, initialOpen }: { storeId: string; initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    const next = !open;
    setOpen(next);
    startTransition(async () => {
      await toggleStoreOpen(storeId, next);
    });
  };

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${
        open ? "bg-emerald-500" : "bg-slate-600"
      }`}
      aria-pressed={open}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          open ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
