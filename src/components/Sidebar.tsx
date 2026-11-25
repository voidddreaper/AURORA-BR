import { Gauge, Pickaxe, Settings as SettingsIcon } from "lucide-react";
import { motion } from "framer-motion";
import type { Page } from "../lib/types";

const NAV: { id: Page; label: string; nick: string; icon: typeof Gauge }[] = [
  { id: "dashboard", label: "Dashboard", nick: "Salvador", icon: Gauge },
  { id: "shaders", label: "Shader Tracker", nick: "Mapa da Mineração", icon: Pickaxe },
  { id: "settings", label: "Settings", nick: "Configurações", icon: SettingsIcon },
];

export type EngineStatus = "connected" | "preview" | "degraded" | "checking";

export function Sidebar({
  page,
  onNavigate,
  engine,
  version,
}: {
  page: Page;
  onNavigate: (p: Page) => void;
  engine: EngineStatus;
  version: string;
}) {
  const status = {
    connected: { dot: "bg-aurora-emerald", text: "text-aurora-emerald", label: "Connected" },
    preview: { dot: "bg-aurora-amber", text: "text-aurora-amber", label: "Browser preview" },
    degraded: { dot: "bg-aurora-amber", text: "text-aurora-amber", label: "Degraded" },
    checking: { dot: "bg-neutral-500", text: "text-neutral-400", label: "Checking…" },
  }[engine];

  return (
    <aside className="glass flex w-16 shrink-0 flex-col border-r border-neutral-900 xl:w-60">
      <nav className="flex flex-1 flex-col gap-1 p-2 pt-4">
        <div className="label mb-2 hidden px-3 xl:block">Modules</div>
        {NAV.map((n) => {
          const active = page === n.id;
          const I = n.icon;
          return (
            <button
              key={n.id}
              onClick={() => onNavigate(n.id)}
              title={n.label}
              className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                active ? "bg-aurora-orange/10 text-white" : "text-neutral-400 hover:bg-white/5 hover:text-neutral-100"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="nav-indicator"
                  className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-aurora-orange shadow-[0_0_12px_#FF6B00]"
                />
              )}
              <I className={`h-[18px] w-[18px] shrink-0 ${active ? "text-aurora-orange" : ""}`} />
              <span className="hidden min-w-0 xl:block">
                <span className="block text-sm font-medium">{n.label}</span>
                <span className="block truncate font-mono text-[10px] text-neutral-500">{n.nick}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="m-2 rounded-lg border border-neutral-800 bg-black/40 p-3">
        <div className="flex items-center gap-2" title={`Engine Status: ${status.label}`}>
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 ${status.dot}`} />
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${status.dot}`} />
          </span>
          <span className="hidden text-xs xl:block">
            <span className="text-neutral-500">Engine Status: </span>
            <span className={`font-medium ${status.text}`}>{status.label}</span>
          </span>
        </div>
        <div className="mt-2 hidden font-mono text-[10px] text-neutral-600 xl:block">v{version} · RDNA2 → DXIL</div>
      </div>
    </aside>
  );
}
