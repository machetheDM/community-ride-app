"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LogIn, MessageSquare } from "lucide-react";
import { signIn, type SignInState } from "@/lib/actions";

const inputClass =
  "w-full bg-[#0f172a] border border-slate-700 focus:border-amber-500 rounded-lg px-3 py-3 text-sm text-slate-100 placeholder-slate-600 outline-none transition-colors";

function SubmitButton({
  intent,
  idle,
  busy,
  icon: Icon,
}: {
  intent: "send" | "verify";
  idle: string;
  busy: string;
  icon: typeof LogIn;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      disabled={pending}
      className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-900 font-semibold text-sm rounded-lg py-3 transition-colors"
    >
      <Icon size={16} />
      {pending ? busy : idle}
    </button>
  );
}

function Message({ state }: { state: SignInState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="text-slate-300 text-xs bg-slate-700/40 border border-slate-600/50 rounded-lg px-3 py-2">
        {state.notice}
      </p>
    );
  }
  return null;
}

/**
 * Two steps on one action: the phone number, then the 6-digit code sent to it.
 * The step lives in the action's returned state, so the server decides when the
 * code step is shown and the browser holds nothing but the number typed.
 */
export function LoginForm() {
  const [state, formAction] = useActionState<SignInState, FormData>(signIn, { step: "phone" });

  if (state.step === "code" && state.phone) {
    return (
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="phone" value={state.phone} />
        <div>
          <label htmlFor="code" className="block text-xs font-medium text-slate-400 mb-1.5">
            Code sent to {state.phone}
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            placeholder="123456"
            className={`${inputClass} tracking-[0.4em] text-center font-mono`}
          />
        </div>

        <Message state={state} />

        <SubmitButton intent="verify" idle="Sign in" busy="Checking…" icon={LogIn} />

        <div className="flex items-center justify-between text-xs">
          <button type="submit" name="intent" value="send" formNoValidate className="text-amber-400 hover:text-amber-300">
            Send a new code
          </button>
          <button type="submit" name="intent" value="restart" formNoValidate className="text-slate-400 hover:text-slate-200">
            Use a different number
          </button>
        </div>
      </form>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="phone" className="block text-xs font-medium text-slate-400 mb-1.5">
          Mobile number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          required
          defaultValue={state.phone}
          placeholder="082 123 4567"
          className={inputClass}
        />
      </div>

      <Message state={state} />

      <SubmitButton intent="send" idle="Send code" busy="Sending…" icon={MessageSquare} />
    </form>
  );
}
