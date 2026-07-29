"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ShoppingBag, Store, Users, Car, Bike, CreditCard, Settings, LogOut, Building2 } from "lucide-react";
import { logoutMerchant } from "@/lib/actions";
import { Avatar } from "@/components/ui/Avatar";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingBag },
  { href: "/dashboard/store", label: "My Store", icon: Store },
];

const adminItems = [
  { href: "/dashboard/stores", label: "Stores", icon: Building2 },
  { href: "/dashboard/drivers", label: "Drivers", icon: Car },
  { href: "/dashboard/riders", label: "Riders", icon: Bike },
  { href: "/dashboard/users", label: "Users", icon: Users },
  { href: "/dashboard/payments", label: "Payments", icon: CreditCard },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

function NavLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: React.ElementType; active: boolean }) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
        active
          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm"
          : "text-slate-400 hover:text-slate-100 hover:bg-slate-700/40 border border-transparent"
      }`}
    >
      <div className={`p-1.5 rounded-lg transition-colors ${active ? "bg-amber-500/10" : "bg-slate-700/30 group-hover:bg-slate-700/50"}`}>
        <Icon size={16} />
      </div>
      {label}
    </Link>
  );
}

export function Sidebar({ name }: { name: string }) {
  const pathname = usePathname();

  return (
    <aside className="w-60 bg-[#1e293b]/90 backdrop-blur-md border-r border-slate-700/50 flex flex-col shrink-0">
      <div className="p-5 border-b border-slate-700/50">
        <div className="flex items-center gap-3">
          <Avatar name={name} size="md" />
          <div className="min-w-0">
            <p className="font-bold text-slate-100 text-sm truncate">{name}</p>
            <p className="text-xs text-slate-400">Merchant Portal</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-auto">
        {navItems.map(({ href, label, icon }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          return <NavLink key={href} href={href} label={label} icon={icon} active={active} />;
        })}

        <div className="pt-3 mt-3 border-t border-slate-700/50">
          <p className="px-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Administration</p>
          {adminItems.map(({ href, label, icon }) => {
            const active = pathname === href || pathname.startsWith(href);
            return <NavLink key={href} href={href} label={label} icon={icon} active={active} />;
          })}
        </div>
      </nav>

      <div className="p-3 border-t border-slate-700/50">
        <form action={logoutMerchant}>
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <div className="p-1.5 rounded-lg bg-slate-700/30">
              <LogOut size={16} />
            </div>
            Sign Out
          </button>
        </form>
      </div>
    </aside>
  );
}
