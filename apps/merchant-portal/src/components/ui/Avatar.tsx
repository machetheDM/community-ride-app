interface AvatarProps {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-xl",
};

export function Avatar({ name, src, size = "md", className = "" }: AvatarProps) {
  const initial = name.charAt(0).toUpperCase();

  if (src) {
    return (
      // Avatars are small, already-sized, and come from arbitrary user-supplied
      // hosts. next/image would require an open remotePatterns allowlist to
      // accept them, which is a worse trade than skipping optimisation here.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className={`rounded-full object-cover border border-slate-600 ${sizeMap[size]} ${className}`}
      />
    );
  }

  return (
    <div
      className={`
        rounded-full flex items-center justify-center font-semibold text-slate-100
        bg-gradient-to-br from-slate-600 to-slate-700 border border-slate-600
        ${sizeMap[size]} ${className}
      `}
    >
      {initial}
    </div>
  );
}
