import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface Option {
  value: string | number;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange"> {
  options: Option[];
  onValueChange?: (value: string) => void;
}

export function Select({ options, className, onValueChange, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100",
        "focus:outline-none focus:ring-2 focus:ring-pokit/50",
        className,
      )}
      onChange={(e) => onValueChange?.(e.target.value)}
      {...props}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
