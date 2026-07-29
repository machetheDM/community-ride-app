interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
  noBackground?: boolean;
}

const paddingMap = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export function Card({ children, className = "", padding = "md", noBackground = false }: CardProps) {
  return (
    <div
      className={`
        rounded-2xl border border-slate-700/50
        ${noBackground ? "" : "bg-[#1e293b]/80 backdrop-blur-sm"}
        ${paddingMap[padding]}
        ${className}
      `}
    >
      {children}
    </div>
  );
}
