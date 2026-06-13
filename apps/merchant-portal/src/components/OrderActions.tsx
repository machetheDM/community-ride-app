"use client";

import { useTransition } from "react";
import { Check, X, ChefHat, PackageCheck } from "lucide-react";
import { updateOrderStatus } from "@/lib/actions";

interface Action {
  label: string;
  status: string;
  variant: "primary" | "danger" | "neutral";
  icon: typeof Check;
}

const NEXT_ACTIONS: Record<string, Action[]> = {
  PENDING: [
    { label: "Accept", status: "CONFIRMED", variant: "primary", icon: Check },
    { label: "Reject", status: "CANCELLED", variant: "danger", icon: X },
  ],
  CONFIRMED: [
    { label: "Start Preparing", status: "PREPARING", variant: "primary", icon: ChefHat },
  ],
  PREPARING: [
    { label: "Mark Ready for Pickup", status: "READY_FOR_PICKUP", variant: "primary", icon: PackageCheck },
  ],
};

const variantClasses: Record<Action["variant"], string> = {
  primary: "bg-amber-500 hover:bg-amber-400 text-slate-900",
  danger: "bg-transparent border border-red-500/40 text-red-400 hover:bg-red-500/10",
  neutral: "bg-slate-700 hover:bg-slate-600 text-slate-100",
};

export function OrderActions({ orderId, status }: { orderId: string; status: string }) {
  const [isPending, startTransition] = useTransition();
  const actions = NEXT_ACTIONS[status];

  if (!actions) {
    return (
      <p className="text-xs text-slate-500 italic">
        {status === "READY_FOR_PICKUP" ? "Waiting for a driver to collect…" : "No actions available"}
      </p>
    );
  }

  const run = (newStatus: string) =>
    startTransition(async () => {
      await updateOrderStatus(orderId, newStatus);
    });

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(({ label, status: s, variant, icon: Icon }) => (
        <button
          key={s}
          disabled={isPending}
          onClick={() => run(s)}
          className={`flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-2 disabled:opacity-50 transition-colors ${variantClasses[variant]}`}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
}
