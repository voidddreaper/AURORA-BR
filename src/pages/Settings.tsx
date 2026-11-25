import { Bell, Database, Gauge, Info, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "../components/Logo";
import { SectionTitle } from "../components/ui";
import { useToast } from "../components/Toast";
import { api, confirmDialog, isTauri, notify } from "../lib/api";
import { useSettings } from "../lib/settings";
import type { AppInfo } from "../lib/types";

export default function SettingsPage({ info, onClearAnalysis }: { info: AppInfo; onClearAnalysis: () => void }) {
  const toast = useToast();
  const [settings, setSettings] = useSettings();
  const [threshold, setThreshold] = useState(String(settings.slowThresholdMs));
  const [expected, setExpected] = useState("");

  useEffect(() => {
    api.shaderStats().then((s) => setExpected(String(s.expectedTotal))).catch(() => {});
  }, []);

  const saveThreshold = () => {
    const v = Number(threshold);
    if (!Number.isFinite(v) || v <= 0 || v > 100000) {
      toast("error", "Invalid threshold", "Use a value between 1 and 100000 ms.");
      setThreshold(String(settings.slowThresholdMs));
      return;
    }
    setSettings({ slowThresholdMs: v });
    toast("success", "Saved", `Shaders ≥ ${v} ms are flagged as Slow JIT (applies to the next analyzed log).`);
  };

  const saveExpected = async () => {
    const v = Math.round(Number(expected));
    if (!Number.isFinite(v) || v < 1) {
      toast("error", "Invalid value");
      return;
    }
    try {
      await api.setExpectedTotal(v);
      toast("success", "Saved", `Expected shader count: ${v.toLocaleString()}`);
    } catch (e) {
      toast("error", "Could not save", String(e));
    }
  };

  const testNotification = async () => {
    const ok = await notify("AuroraBR", "Notifications are working ✓");
    if (ok) toast("success", "Notification sent");
    else toast("warn", "Notification not shown", isTauri ? "Allow notifications for AuroraBR in Windows Settings → System → Notifications." : "Only available in the desktop app.");
  };

  const resetTracker = async () => {
    if (!(await confirmDialog("Replace ALL tracker data with the 5 demo shaders? This cannot be undone."))) return;
    try {
      await api.resetShaderDemo();
      toast("success", "Tracker reset to demo data");
    } catch (e) {
      toast("error", "Reset failed", String(e));
    }
  };

  const clearTracker = async () => {
    if (!(await confirmDialog("Delete ALL shaders from the tracker? This cannot be undone. Tip: use Export CSV first."))) return;
    try {
      await api.clearShaders();
      toast("success", "Tracker cleared");
    } catch (e) {
      toast("error", "Clear failed", String(e));
    }
  };

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5 p-5 lg:p-6">
      <div>
        <div className="label text-aurora-orange">Configurações</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Settings</h1>
      </div>

      <div className="card overflow-hidden">
        <SectionTitle icon={<Gauge className="h-4 w-4 text-aurora-orange" />} title="Log analyzer" />
        <Row title="Slow JIT threshold" desc="Shader compilations at or above this time are flagged red in the Gargoyles table.">
          <div className="flex items-center gap-2">
            <input className="input w-28 text-right font-mono" type="number" min={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveThreshold()} />
            <span className="text-sm text-neutral-500">ms</span>
            <button className="btn-ghost" onClick={saveThreshold} disabled={String(settings.slowThresholdMs) === threshold}>
              Save
            </button>
          </div>
        </Row>
        <Row title="Reset dashboard" desc="Forget the last analyzed log and show the demo dataset.">
          <button className="btn-ghost" onClick={() => { onClearAnalysis(); toast("info", "Dashboard reset"); }}>
            <RotateCcw className="h-4 w-4" /> Reset
          </button>
        </Row>
      </div>

      <div className="card overflow-hidden">
        <SectionTitle icon={<Bell className="h-4 w-4 text-aurora-orange" />} title="Notifications" />
        <Row title="Native OS notifications" desc="Show a Windows notification when Failed shader details are copied.">
          <div className="flex items-center gap-3">
            <Toggle checked={settings.notifications} onChange={(v) => setSettings({ notifications: v })} />
            <button className="btn-ghost" onClick={testNotification}>
              Test
            </button>
          </div>
        </Row>
      </div>

      <div className="card overflow-hidden">
        <SectionTitle icon={<Database className="h-4 w-4 text-aurora-orange" />} title="Shader Tracker data" />
        <Row title="Expected shader count" desc="Total shaders expected in the game (used for catalogue coverage).">
          <div className="flex items-center gap-2">
            <input className="input w-32 text-right font-mono" type="number" min={1} value={expected} onChange={(e) => setExpected(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveExpected()} />
            <button className="btn-ghost" onClick={saveExpected}>
              Save
            </button>
          </div>
        </Row>
        <Row title="Reset to demo data" desc="Replace the tracker contents with the 5 sample shaders.">
          <button className="btn-ghost" onClick={resetTracker}>
            <RotateCcw className="h-4 w-4" /> Reset
          </button>
        </Row>
        <Row title="Clear tracker" desc="Remove every shader from the local database.">
          <button className="btn-danger" onClick={clearTracker}>
            <Trash2 className="h-4 w-4" /> Clear all
          </button>
        </Row>
        <Row title="Database file" desc="SQLite database location (back it up to keep your progress).">
          <code className="selectable max-w-[420px] break-all rounded bg-black px-2 py-1 font-mono text-xs text-neutral-400">{info.dbPath || "—"}</code>
        </Row>
      </div>

      <div className="card overflow-hidden">
        <SectionTitle icon={<Info className="h-4 w-4 text-aurora-orange" />} title="About" />
        <div className="flex items-center gap-4 p-5">
          <Logo size={44} />
          <div>
            <div className="text-lg font-bold text-white">
              Aurora<span className="text-aurora-orange">BR</span> <span className="font-mono text-sm font-normal text-neutral-500">v{info.version}</span>
            </div>
            <div className="text-sm text-neutral-500">Ferramenta brasileira para análise de recompilação de jogos · Tauri + Rust + React</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-900 px-5 py-4 last:border-b-0">
      <div className="min-w-0 max-w-xl">
        <div className="text-sm font-medium text-neutral-100">{title}</div>
        <div className="mt-0.5 text-xs text-neutral-500">{desc}</div>
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${checked ? "bg-aurora-orange" : "bg-neutral-800"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}
