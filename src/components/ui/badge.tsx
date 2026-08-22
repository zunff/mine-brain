import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "accent" | "muted" | "danger" | "outline" | "superseded";
}

export function Badge({
  className,
  variant = "default",
  children,
  ...props
}: BadgeProps) {
  const baseStyles =
    "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium transition-colors border";

  const variantStyles = {
    default: "bg-surface-2 text-foreground border-borderline",
    accent: "bg-accent-soft text-accent border-accent/30 font-semibold",
    muted: "bg-surface-2 text-muted border-borderline/60",
    danger: "bg-danger-soft text-danger border-danger/30",
    outline: "bg-transparent text-muted border-borderline hover:border-accent/40",
    superseded: "bg-surface-2 text-muted/60 border-borderline/40 line-through",
  };

  return (
    <span
      className={cn(baseStyles, variantStyles[variant], className)}
      {...props}
    >
      {children}
    </span>
  );
}
