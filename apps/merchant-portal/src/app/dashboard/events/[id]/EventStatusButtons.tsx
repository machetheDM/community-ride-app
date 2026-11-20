"use client";

import { useState, useTransition } from "react";
import { setEventStatus } from "@/lib/event-actions";

/** Publish a draft, or cancel an event. The server checks every condition again. */
export function EventStatusButtons({ eventId, status }: { eventId: string; status: "DRAFT" | "PUBLISHED" | "CANCELLED" }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (next: "PUBLISHED" | "CANCELLED") => {
    if (next === "CANCELLED" && !window.confirm("Cancel this event? Every trip request and group trip for it is cancelled too.")) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await setEventStatus(eventId, next);
      if ("error" in result) setError(result.error);
    });
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {status === "DRAFT" && (
        <button
          onClick={() => run("PUBLISHED")}
          disabled={isPending}
          className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-900 font-semibold text-sm rounded-lg px-4 py-2.5"
        >
          Publish
        </button>
      )}
      {status !== "CANCELLED" && (
        <button
          onClick={() => run("CANCELLED")}
          disabled={isPending}
          className="border border-red-500/50 text-red-400 hover:bg-red-500/10 disabled:opacity-60 text-sm font-semibold rounded-lg px-4 py-2.5"
        >
          Cancel event
        </button>
      )}
      {error && (
        <span role="alert" className="text-sm text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
