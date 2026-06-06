import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { useToastStore, type ToastVariant } from "@/store/toastStore";
import { cn } from "@/lib/utils";

const styles: Record<ToastVariant, { ring: string; icon: typeof Info }> = {
  info: { ring: "border-sky-700/60 bg-sky-950/80", icon: Info },
  success: { ring: "border-green-700/60 bg-green-950/80", icon: CheckCircle2 },
  warning: { ring: "border-amber-700/60 bg-amber-950/80", icon: AlertTriangle },
  error: { ring: "border-red-700/60 bg-red-950/80", icon: XCircle },
};

export function ToastContainer() {
  const { toasts, dismiss } = useToastStore();

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => {
        const { ring, icon: Icon } = styles[t.variant];
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur",
              "animate-in slide-in-from-right-4 fade-in",
              ring,
            )}
            role="status"
          >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <span className="flex-1 text-neutral-100">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="text-neutral-400 transition-colors hover:text-neutral-100"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
