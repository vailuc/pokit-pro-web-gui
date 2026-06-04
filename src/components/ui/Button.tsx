import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "toggle";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  active?: boolean;
}

const variants: Record<Variant, string> = {
  primary: "bg-pokit text-neutral-900 hover:bg-pokit-dark font-semibold",
  secondary: "bg-neutral-800 text-neutral-100 hover:bg-neutral-700",
  ghost: "bg-transparent text-neutral-300 hover:bg-neutral-800",
  danger: "bg-red-600 text-white hover:bg-red-500",
  toggle: "bg-neutral-800 text-neutral-300 hover:bg-neutral-700",
};

const sizes: Record<Size, string> = {
  sm: "px-2.5 py-1 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", active, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-pokit/50",
        variants[variant],
        sizes[size],
        active && "ring-2 ring-pokit bg-pokit text-neutral-900",
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
