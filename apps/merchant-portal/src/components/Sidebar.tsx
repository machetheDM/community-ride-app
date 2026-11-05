"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingBag,
  Store,
  Users,
  Car,
  Bike,
  CreditCard,
  Settings,
  LogOut,
  Building2,
  BarChart3,
  ShieldOff,
} from "lucide-react";
import { signOut, signOutEverywhere } from "@/lib/actions";
import type { NavIcon, NavSections } from "@/lib/access";
import { Avatar } from "@/components/ui/Avatar";

const icons: Record<NavIcon, React.ElementType> = {
  overview: LayoutDashboard,
  orders: ShoppingBag,
  store: Store,
  analytics: BarChart3,
  stores: Building2,
  drivers: Car,
  riders: Bike,
  users: Users,
  payments: CreditCard,
  settings: Settings,
};

function NavLink({ href, label, icon, active }: { href: string; label: string; icon: NavIcon; active: boolean }) {
  const Icon = icons[icon];
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

/**
 * Shows only the links the signed-in role may open (`navFor` in `lib/access.ts`).
 * Hiding a link is a courtesy, not a control: every page enforces its own access.
 */
export function Sidebar({ name, roleLabel, nav }: { name: string; roleLabel: string; nav: NavSections }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <aside className="w-60 bg-[#1e293b]/90 backdrop-blur-md border-r border-slate-700/50 flex flex-col shrink-0">
      <div className="p-5 border-b border-slate-700/50">
        <div className="flex items-center gap-3">
          <Avatar name={name} size="md" />
          <div className="min-w-0">
            <p className="font-bold text-slate-100 text-sm truncate">{name}</p>
            <p className="text-xs text-slate-400">{roleLabel}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-auto">
        {nav.main.map(({ href, label, icon }) => (
          <NavLink key={href} href={href} label={label} icon={icon} active={isActive(href)} />
        ))}

        {nav.admin.length > 0 && (
          <div className="pt-3 mt-3 border-t border-slate-700/50">
            <p className="px-3 text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Administration</p>
            {nav.admin.map(({ href, label, icon }) => (
              <NavLink key={href} href={href} label={label} icon={icon} active={isActive(href)} />
            ))}
          </div>
        )}
      </nav>

      <div className="p-3 border-t border-slate-700/50 space-y-1">
        <form action={signOut}>
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
        <form action={signOutEverywhere}>
          <button
            type="submit"
            title="Ends every portal session and signs this number out of the apps"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <div className="p-1.5 rounded-lg bg-slate-700/30">
              <ShieldOff size={14} />
            </div>
            Sign out everywhere
          </button>
        </form>
      </div>
    </aside>
  );
}
