import { cn } from "@/lib/utils";

interface ReadoutProps {
  value: string;
  label?: string;
  sub?: string;
  className?: string;
  accent?: boolean;
  gated?: boolean;
}

/** Large primary measurement display. */
export function Readout({ value, label, sub, className, accent = true, gated }: ReadoutProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-8", className)}>
      {label && <div className="mb-1 text-xs uppercase tracking-widest text-neutral-500">{label}</div>}
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "font-mono text-6xl font-bold tabular-nums tracking-tight sm:text-7xl",
            accent ? "text-pokit" : "text-neutral-100",
            gated && "text-red-400",
          )}
        >
          {value}
        </div>
        {gated && (
          <div className="relative -top-4">
            <div className="h-2 w-2 rounded-full bg-red-500" title="Gated: reading within noise floor" />
          </div>
        )}
      </div>
      {sub && <div className="mt-2 text-sm text-neutral-400">{sub}</div>}
    </div>
  );
}
