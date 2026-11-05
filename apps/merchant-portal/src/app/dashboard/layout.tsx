import { requireSession } from "@/lib/session";
import { navFor } from "@/lib/access";
import { Sidebar } from "@/components/Sidebar";

/**
 * The shell only. This check decides what the sidebar shows; it does not protect
 * any page, because a layout neither re-runs on navigation nor stops its pages
 * from rendering. Each page calls `requireAdmin()` or `requireMerchant()` itself.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <div className="flex min-h-screen">
      <Sidebar
        name={session.name}
        roleLabel={session.role === "ADMIN" ? "Administrator" : "Merchant"}
        nav={navFor(session)}
      />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
