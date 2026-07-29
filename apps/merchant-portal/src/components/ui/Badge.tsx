interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger" | "info" | "neutral";
  dot?: boolean;
  className?: string;
}

const variantMap = {
  default: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  danger: "bg-red-500/10 text-red-400 border-red-500/20",
  info: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  neutral: "bg-slate-700/40 text-slate-400 border-slate-600/30",
};

export function Badge({ children, variant = "default", dot = false, className = "" }: BadgeProps) {
  const colorMap: Record<string, string> = {
    default: "bg-amber-400",
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    danger: "bg-red-400",
    info: "bg-blue-400",
    neutral: "bg-slate-500",
  };

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 text-[11px] font-semibold
        px-2.5 py-1 rounded-full border
        ${variantMap[variant]}
        ${className}
      `}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${colorMap[variant]} animate-pulse`} />}
      {children}
    </span>
  );
}
