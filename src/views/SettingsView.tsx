import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useSettingsStore } from "@/store/settingsStore";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "dark", label: "🌙 Dark" },
  { value: "light", label: "☀️ Light" },
  { value: "auto", label: "🔄 Auto" },
];

const ACCENTS = [
  { value: "blue", label: "Blue", color: "#3b82f6" },
  { value: "red", label: "Red", color: "#ef4444" },
  { value: "green", label: "Green", color: "#22c55e" },
  { value: "amber", label: "Amber", color: "#f59e0b" },
  { value: "purple", label: "Purple", color: "#a855f7" },
];

const TABS = [
  { value: "meter", label: "Multimeter" },
  { value: "scope", label: "Oscilloscope" },
  { value: "logger", label: "Data Logger" },
  { value: "device", label: "Device Info" },
];

const BACKENDS = [
  { value: "web-bluetooth", label: "Web Bluetooth" },
  { value: "bridge", label: "Python Bridge" },
];

export function SettingsView() {
  const { ui, plugins, updateUI, updatePlugin, isSynced } = useSettingsStore();

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <h1 className="text-2xl font-bold">Settings</h1>

      {!isSynced && (
        <div className="rounded-md bg-amber-900/30 border border-amber-700 px-4 py-3 text-sm text-amber-200">
          Using local settings. Connect to bridge to sync.
        </div>
      )}

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle>🎨 Appearance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Theme</label>
            <div className="flex gap-2">
              {THEMES.map(({ value, label }) => (
                <Button
                  key={value}
                  variant={ui.theme === value ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => updateUI("theme", value as typeof ui.theme)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Accent Color</label>
            <div className="flex gap-3">
              {ACCENTS.map(({ value, label, color }) => (
                <button
                  key={value}
                  onClick={() => updateUI("accent", value as typeof ui.accent)}
                  className={cn(
                    "group flex flex-col items-center gap-1",
                    ui.accent === value && "scale-110"
                  )}
                >
                  <div
                    className={cn(
                      "w-10 h-10 rounded-full border-2 transition-all",
                      ui.accent === value ? "border-white ring-2 ring-[var(--color-accent)]" : "border-transparent"
                    )}
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connection */}
      <Card>
        <CardHeader>
          <CardTitle>📡 Connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Default Connection Mode</label>
            <div className="flex gap-2">
              {BACKENDS.map(({ value, label }) => (
                <Button
                  key={value}
                  variant={ui.connectionMode === value ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => updateUI("connectionMode", value as typeof ui.connectionMode)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Bridge URL</label>
            <input
              type="text"
              value={ui.bridgeUrl}
              onChange={(e) => updateUI("bridgeUrl", e.target.value)}
              placeholder="ws://localhost:8765"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              WebSocket URL for Python bridge server
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Defaults */}
      <Card>
        <CardHeader>
          <CardTitle>⚡ Defaults</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Startup Tab</label>
            <Select
              value={ui.startupTab}
              options={TABS}
              onValueChange={(v) => updateUI("startupTab", v as typeof ui.startupTab)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">DSO Mode</label>
            <div className="flex gap-2">
              {[
                { value: "one-shot", label: "One-shot" },
                { value: "continuous", label: "Continuous" },
              ].map(({ value, label }) => (
                <Button
                  key={value}
                  variant={plugins.dso.defaultMode === value ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => updatePlugin("dso", "defaultMode", value as typeof plugins.dso.defaultMode)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">DSO Window Time (Web Bluetooth)</label>
            <Select
              value={String(plugins.dso.defaultWindowMs)}
              options={[
                { value: "10", label: "10 ms 🔴 (256 samples)" },
                { value: "20", label: "20 ms 🔴 (512 samples)" },
                { value: "35", label: "35 ms 🟡 (896 samples)" },
                { value: "50", label: "50 ms 🌐 (1,280 samples)" },
                { value: "100", label: "100 ms (2,560 samples)" },
                { value: "200", label: "200 ms (5,120 samples)" },
              ]}
              onValueChange={(v) => updatePlugin("dso", "defaultWindowMs", Number(v))}
            />
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              🔴 Likely Limited &nbsp; 🟡 Generally Usable &nbsp; 🌐 Optimal
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>🔔 Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={plugins.meter.operationalWarnings}
              onChange={(e) => updatePlugin("meter", "operationalWarnings", e.target.checked)}
              className="h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
            />
            <span className="text-sm text-[var(--color-text)]">
              Show operational warnings (switch position, clipping, etc.)
            </span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={plugins.dso.performanceHints}
              onChange={(e) => updatePlugin("dso", "performanceHints", e.target.checked)}
              className="h-4 w-4 rounded border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
            />
            <span className="text-sm text-[var(--color-text)]">
              Show performance hints (Web Bluetooth limits)
            </span>
          </label>
        </CardContent>
      </Card>

      {/* Data Management */}
      <Card>
        <CardHeader>
          <CardTitle>🧹 Data Management</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button variant="danger" size="sm" onClick={clearHistory}>
            Clear History
          </Button>
          <Button variant="danger" size="sm" onClick={resetBaselines}>
            Reset Baselines
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function clearHistory() {
  if (confirm("Clear all saved measurements?")) {
    localStorage.removeItem("pokit-history");
    window.location.reload();
  }
}

function resetBaselines() {
  if (confirm("Reset all noise baselines to defaults?")) {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("noiseBaseline_")) {
        localStorage.removeItem(key);
      }
    });
    window.location.reload();
  }
}
