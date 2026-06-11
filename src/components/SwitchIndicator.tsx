import { getSwitchPosition, type DeviceStatusCode } from "@/pokit";

interface SwitchIndicatorProps {
  status: DeviceStatusCode | null;
  manualOverride?: boolean;
  mismatched?: boolean;
}

/** Single-character switch indicator.
 *  Shows V / A / Ω, or "-" when between detents.
 *  - Teal = known position
 *  - Orange pulse = transit (idle)
 *  - Yellow-blue = mismatch flash
 */
export function SwitchIndicator({ status, manualOverride, mismatched }: SwitchIndicatorProps) {
  const pos = status !== null ? getSwitchPosition(status) : null;

  const displayChar = (() => {
    if (pos === "idle") return "-";
    if (pos === "V" || pos === "logger") return "V";
    if (pos === "A") return "A";
    if (pos === "Ω") return "Ω";
    return "—";
  })();

  const isIdle = pos === "idle";

  const classes = [
    "grid h-8 w-8 place-items-center rounded-lg border text-sm font-bold tabular-nums transition-colors",
    isIdle
      ? "border-orange-500/40 bg-orange-950/30 text-orange-400 animate-pulse"
      : mismatched
        ? "border-yellow-400/60 bg-yellow-950/40 text-yellow-300 animate-[mismatchFlash_0.6s_ease-in-out_infinite]"
        : "border-teal-500/40 bg-teal-950/30 text-teal-400",
  ].join(" ");

  return (
    <div className="relative flex items-center">
      <div className={classes} title={isIdle ? "Verify Switch" : `Switch: ${displayChar}`}>
        {displayChar}
      </div>
      {manualOverride && !isIdle && (
        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded bg-neutral-700 px-1 text-[9px] font-bold uppercase tracking-wider text-neutral-300">
          Man
        </span>
      )}
    </div>
  );
}
