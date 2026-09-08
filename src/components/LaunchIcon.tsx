interface LaunchIconProps {
  icon?: string;
  fallback: string;
  className?: string;
}

export function isImageIcon(icon?: string): boolean {
  return Boolean(icon?.startsWith("data:image/"));
}

export function LaunchIcon({ icon, fallback, className }: LaunchIconProps) {
  const value = icon || fallback.slice(0, 1) || "✦";
  if (isImageIcon(value)) {
    return <img className={className} src={value} alt="" draggable={false} />;
  }
  return <span className={className}>{value}</span>;
}
