import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign In" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-amber-500 flex items-center justify-center text-slate-900 font-bold text-2xl mb-4">
            M
          </div>
          <h1 className="text-xl font-bold text-slate-100">Merchant Portal</h1>
          <p className="text-slate-400 text-sm mt-1">Sign in with a code sent to your phone</p>
        </div>

        <div className="bg-[#1e293b] border border-slate-700 rounded-2xl p-6">
          <LoginForm />
        </div>

        {process.env.NODE_ENV === "development" && (
          <p className="text-center text-slate-500 text-xs mt-6">
            Development: the seeded merchant is <span className="text-slate-400 font-medium">+27 81 000 0001</span>, and
            the code is printed in the portal&apos;s server console.
          </p>
        )}
      </div>
    </div>
  );
}
