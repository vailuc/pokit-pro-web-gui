import { useState } from "react";
import { Activity, Gauge, LineChart, Info, Settings } from "lucide-react";
import { ConnectBar } from "./components/ConnectBar";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { ToastContainer } from "./components/Toast";
import { ThemeProvider } from "./components/ThemeProvider";
import { MultimeterView } from "./views/MultimeterView";
import { OscilloscopeView } from "./views/OscilloscopeView";
import { LoggerView } from "./views/LoggerView";
import { DeviceInfoView } from "./views/DeviceInfoView";
import { SettingsView } from "./views/SettingsView";
import { useSettingsStore } from "./store/settingsStore";
import { cn } from "./lib/utils";

type Tab = "meter" | "scope" | "logger" | "device" | "settings";

const TABS: { id: Tab; label: string; icon: typeof Gauge }[] = [
  { id: "meter", label: "Multimeter", icon: Gauge },
  { id: "scope", label: "Oscilloscope", icon: Activity },
  { id: "logger", label: "Data Logger", icon: LineChart },
  { id: "device", label: "Device", icon: Info },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function App() {
  const { ui } = useSettingsStore();
  const [tab, setTab] = useState<Tab>(ui.startupTab);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <ThemeProvider>
    <div className="flex min-h-full flex-col">
      <ConnectBar onOpenHistory={() => setHistoryOpen(true)} />
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <ToastContainer />

      <nav className="flex gap-1 border-b border-neutral-800 bg-neutral-900/50 px-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
              tab === id
                ? "border-pokit text-pokit"
                : "border-transparent text-neutral-400 hover:text-neutral-200",
            )}
          >
            <Icon size={16} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </nav>

      <main className="flex-1 p-4 sm:p-6">
        {tab === "meter" && <MultimeterView />}
        {tab === "scope" && <OscilloscopeView />}
        {tab === "logger" && <LoggerView />}
        {tab === "device" && <DeviceInfoView />}
        {tab === "settings" && <SettingsView />}
      </main>

      <footer className="border-t border-neutral-800 px-4 py-2 text-center text-xs text-neutral-600">
        Pokit Pro Web GUI · Web Bluetooth · protocol via pcolby/dokit
      </footer>
    </div>
    </ThemeProvider>
  );
}
