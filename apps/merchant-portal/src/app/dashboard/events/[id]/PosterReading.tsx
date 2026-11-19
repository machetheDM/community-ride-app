"use client";

import { useState, useTransition } from "react";
import { applyPosterReading, readEventPoster } from "@/lib/poster-actions";

export interface ReadingView {
  id: string;
  outcome: "OK" | "INVALID" | "ERROR";
  model: string;
  promptVersion: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  problem: string | null;
  stale: boolean;
  applied: boolean;
  createdAt: string;
  rows: { field: string; label: string; current: string; proposed: string | null; applicable: boolean }[];
  setAside: { field: string; reason: string; excerpt: string }[];
}

/**
 * The poster reader on an event's page (docs/PLAN.md 4.3, ADR 0008). The admin
 * reads the poster, compares each proposed field with the poster beside it,
 * ticks what is right and applies it to the draft. Publishing is still the
 * Publish button, after this.
 */
export function PosterReading({
  eventId,
  isDraft,
  refusal,
  reading,
}: {
  eventId: string;
  isDraft: boolean;
  /** Why reading is not offered right now, or null. */
  refusal: string | null;
  reading: ReadingView | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const applicable = reading?.rows.filter((r) => r.applicable && r.proposed !== null).map((r) => r.field) ?? [];
  const [ticked, setTicked] = useState<string[]>(applicable);

  const read = () => {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await readEventPoster(eventId);
      if ("error" in result) setError(result.error);
    });
  };

  const apply = () => {
    if (!reading) return;
    setError(null);
    startTransition(async () => {
      const result = await applyPosterReading(reading.id, ticked);
      if ("error" in result) setError(result.error);
      else setDone("Applied to the draft. Check the event, then publish it when it is right.");
    });
  };

  const toggle = (field: string) => setTicked((t) => (t.includes(field) ? t.filter((f) => f !== field) : [...t, field]));
  const canApply = reading?.outcome === "OK" && !reading.applied && !reading.stale && isDraft;

  return (
    <div className="space-y-4">
      {refusal ? (
        <p className="text-sm text-slate-400">{refusal}. The event&apos;s details are typed in by hand.</p>
      ) : (
        <button
          onClick={read}
          disabled={isPending}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-900 font-semibold text-sm rounded-lg px-4 py-2.5"
        >
          {isPending ? "Working…" : reading ? "Read the poster again" : "Read the poster"}
        </button>
      )}

      {reading && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            {reading.createdAt} · {reading.model} · {reading.promptVersion} · {reading.latencyMs} ms
            {reading.inputTokens !== null ? ` · ${reading.inputTokens} + ${reading.outputTokens} tokens` : ""}
            {reading.costUsd !== null ? ` · $${reading.costUsd}` : " · no price configured"}
          </p>

          {reading.problem && <p className="text-sm text-red-400">{reading.problem}</p>}
          {reading.stale && <p className="text-sm text-amber-400">The poster has changed since this reading. Read it again.</p>}
          {reading.applied && <p className="text-sm text-emerald-400">Applied to the draft.</p>}

          {reading.outcome === "OK" && (
            <>
              <p className="text-sm text-slate-300">
                Check each field against the poster. Only ticked fields are applied, and only to the draft.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400">
                    <th className="py-1 w-8"></th>
                    <th className="py-1">Field</th>
                    <th className="py-1">Read from the poster</th>
                    <th className="py-1">On the draft now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {reading.rows.map((r) => (
                    <tr key={r.field}>
                      <td className="py-2">
                        {r.applicable && r.proposed !== null && (
                          <input
                            type="checkbox"
                            aria-label={`Apply ${r.label}`}
                            checked={ticked.includes(r.field)}
                            onChange={() => toggle(r.field)}
                            disabled={!canApply}
                          />
                        )}
                      </td>
                      <td className="py-2 text-slate-400">{r.label}</td>
                      <td className="py-2 text-slate-100">
                        {r.proposed ?? <span className="text-slate-500">nothing</span>}
                        {!r.applicable && r.proposed !== null && (
                          <span className="block text-xs text-slate-500">For checking only: the venue is the partner this event was made under.</span>
                        )}
                      </td>
                      <td className="py-2 text-slate-400">{r.current || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {reading.setAside.length > 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                  <p className="text-sm font-semibold text-amber-300 mb-1">Set aside, not proposed</p>
                  <ul className="space-y-1 text-xs text-slate-300">
                    {reading.setAside.map((s, i) => (
                      <li key={`${s.field}-${i}`}>
                        <span className="text-slate-400">{s.field}</span> {s.reason}: <q className="text-slate-500">{s.excerpt}</q>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-slate-500 mt-2">If the poster really says it, type it in yourself.</p>
                </div>
              )}

              {canApply && (
                <button
                  onClick={apply}
                  disabled={isPending || ticked.length === 0}
                  className="border border-amber-500 text-amber-400 hover:bg-amber-500/10 disabled:opacity-60 text-sm font-semibold rounded-lg px-4 py-2.5"
                >
                  Apply the ticked fields to the draft
                </button>
              )}
            </>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {done && <p className="text-sm text-emerald-400">{done}</p>}
    </div>
  );
}
