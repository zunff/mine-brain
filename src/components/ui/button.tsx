import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg" | "icon";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", disabled, ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer active:scale-[0.98]";

    const variantStyles = {
      primary:
        "bg-accent text-accent-foreground hover:bg-accent-hover font-semibold shadow-sm",
      secondary:
        "bg-surface-2 text-foreground border border-borderline hover:bg-surface-hover hover:border-accent/40",
      ghost:
        "text-muted hover:text-foreground hover:bg-surface-2",
      outline:
        "border border-borderline text-foreground hover:bg-surface-2 hover:border-accent/50",
      danger:
        "bg-danger-soft text-danger hover:bg-danger hover:text-white border border-danger/20",
    };

    const sizeStyles = {
      sm: "h-8 px-2.5 text-xs gap-1.5",
      md: "h-9 px-3.5 text-sm gap-2",
      lg: "h-11 px-5 text-base gap-2.5",
      icon: "h-9 w-9 p-0 text-sm",
    };

    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          baseStyles,
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
