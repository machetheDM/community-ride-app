import { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  color: "amber" | "blue" | "emerald" | "purple" | "red" | "cyan";
}

const colorMap = {
  amber: { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  blue: { text: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  emerald: { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  purple: { text: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
  red: { text: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
  cyan: { text: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
};

export function StatCard({ label, value, sub, icon: Icon, color }: StatCardProps) {
  const colors = colorMap[color];
  return (
    <div className={`rounded-2xl p-6 border ${colors.border} bg-[#1e293b]/80`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">{label}</p>
          <p className="text-3xl font-bold text-slate-100 mt-2">{value}</p>
          {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
        </div>
        <div className={`${colors.bg} p-3 rounded-xl`}>
          <Icon size={20} className={colors.text} />
        </div>
      </div>
    </div>
  );
}
