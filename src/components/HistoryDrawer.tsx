import { useEffect, useState } from "react";
import { History, X, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  listHistory,
  deleteHistory,
  clearHistory,
  exportCsv,
  downloadBlob,
  type HistoryEntry,
} from "@/store/historyStore";

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function HistoryDrawer({ open, onClose }: HistoryDrawerProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  const refresh = async () => {
    setEntries(await listHistory());
  };

  useEffect(() => {
    if (open) refresh();
  }, [open]);

  const handleDelete = async (id: string) => {
    await deleteHistory(id);
    refresh();
  };

  const handleClear = async () => {
    if (!confirm("Clear all history?")) return;
    await clearHistory();
    refresh();
  };

  const handleExport = (entry: HistoryEntry) => {
    const csv = exportCsv(entry);
    if (csv) {
      downloadBlob(csv, `pokit-${entry.type}-${entry.timestamp}.csv`);
    }
  };

  const typeLabel = (type: string) => {
    switch (type) {
      case "meter":
        return "Multimeter";
      case "scope":
        return "Oscilloscope";
      case "logger":
        return "Logger";
      default:
        return type;
    }
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
      )}
      {/* Drawer */}
      <div
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-md transform border-l border-neutral-800 bg-neutral-900 shadow-xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <History size={16} />
              Measurement History
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X size={16} />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {entries.length === 0 ? (
              <p className="text-center text-sm text-neutral-500">No saved measurements yet.</p>
            ) : (
              <div className="space-y-3">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-neutral-800 bg-neutral-800/50 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-pokit">{typeLabel(entry.type)}</div>
                        <div className="text-sm text-neutral-200">{entry.name}</div>
                        <div className="text-[10px] text-neutral-500">
                          {new Date(entry.timestamp).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => handleExport(entry)} title="Export CSV">
                          <Download size={14} />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(entry.id)} title="Delete">
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {entries.length > 0 && (
            <div className="border-t border-neutral-800 p-4">
              <Button variant="danger" size="sm" className="w-full" onClick={handleClear}>
                Clear all history
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
