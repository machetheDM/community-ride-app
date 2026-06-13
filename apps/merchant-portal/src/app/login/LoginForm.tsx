"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LogIn } from "lucide-react";
import { loginMerchant, type LoginState } from "@/lib/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-900 font-semibold text-sm rounded-lg py-3 transition-colors"
    >
      <LogIn size={16} />
      {pending ? "Signing in…" : "Sign In"}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(loginMerchant, {});

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="phone" className="block text-xs font-medium text-slate-400 mb-1.5">
          Phone Number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+27 81 000 0001"
          className="w-full bg-[#0f172a] border border-slate-700 focus:border-amber-500 rounded-lg px-3 py-3 text-sm text-slate-100 placeholder-slate-600 outline-none transition-colors"
        />
      </div>

      {state.error && (
        <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
