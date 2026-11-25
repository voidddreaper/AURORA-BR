import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { isTauri } from "../lib/api";
import { Logo } from "./Logo";

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export function TitleBar({ subtitle }: { subtitle: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      try {
        const w = await win();
        setMaximized(await w.isMaximized());
        const un = await w.onResized(async () => {
          try {
            setMaximized(await w.isMaximized());
          } catch {
            /* window closing */
          }
        });
        if (disposed) un();
        else unlisten = un;
      } catch {
        /* ignore */
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const act = (fn: "minimize" | "toggleMaximize" | "close") => async () => {
    if (!isTauri) return;
    try {
      const w = await win();
      await w[fn]();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <header
      data-tauri-drag-region
      className="glass relative z-50 flex h-10 shrink-0 items-center border-b border-neutral-900 pl-3"
      style={{ background: "linear-gradient(90deg, rgba(255,107,0,0.10), rgba(0,0,0,0.6) 35%, rgba(0,0,0,0.6))" }}
    >
      <div data-tauri-drag-region className="flex items-center gap-2.5">
        <Logo size={18} />
        <span data-tauri-drag-region className="text-[13px] font-bold tracking-wide text-white">
          Aurora<span className="text-aurora-orange">BR</span>
        </span>
        <span data-tauri-drag-region className="hidden font-mono text-[11px] text-neutral-500 md:inline">
          // {subtitle}
        </span>
      </div>
      <div data-tauri-drag-region className="flex-1 self-stretch" />
      <div className="flex h-full">
        <button aria-label="Minimize" onClick={act("minimize")} className="flex h-full w-12 items-center justify-center text-neutral-400 transition-colors hover:bg-white/10 hover:text-white">
          <Minus className="h-4 w-4" />
        </button>
        <button aria-label={maximized ? "Restore" : "Maximize"} onClick={act("toggleMaximize")} className="flex h-full w-12 items-center justify-center text-neutral-400 transition-colors hover:bg-white/10 hover:text-white">
          {maximized ? <Copy className="h-3.5 w-3.5 -scale-x-100" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button aria-label="Close" onClick={act("close")} className="flex h-full w-12 items-center justify-center text-neutral-400 transition-colors hover:bg-aurora-crimson hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-aurora-orange/70 via-aurora-orange/10 to-transparent" />
    </header>
  );
}
