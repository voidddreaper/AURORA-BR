import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar, type EngineStatus } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { useToast } from "./components/Toast";
import { api, isTauri } from "./lib/api";
import { demoAnalysis } from "./lib/mock";
import { loadLastAnalysis, saveLastAnalysis, useSettings } from "./lib/settings";
import type { Analysis, AppInfo, Page } from "./lib/types";
import Dashboard from "./pages/Dashboard";
import SettingsPage from "./pages/Settings";
import ShaderTracker from "./pages/ShaderTracker";

const SUBTITLES: Record<Page, string> = {
  dashboard: "log analyzer · salvador",
  shaders: "shader tracker · mapa da mineração",
  settings: "settings",
};

export const ACCEPTED_EXT = ["log", "txt"];

export default function App() {
  const toast = useToast();
  const [settings] = useSettings();
  const [page, setPage] = useState<Page>("dashboard");
  const [analysis, setAnalysis] = useState<Analysis>(() => loadLastAnalysis() ?? demoAnalysis());
  const [loading, setLoading] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [engine, setEngine] = useState<EngineStatus>("checking");
  const [info, setInfo] = useState<AppInfo>({ version: "1.0.0", dbPath: "", dbWarning: null });
  const reqId = useRef(0);
  const thresholdRef = useRef(settings.slowThresholdMs);
  thresholdRef.current = settings.slowThresholdMs;

  // Engine / backend health
  useEffect(() => {
    api
      .appInfo()
      .then((i) => {
        setInfo(i);
        setEngine(!isTauri ? "preview" : i.dbWarning ? "degraded" : "connected");
        if (i.dbWarning) toast("warn", "Database warning", i.dbWarning);
      })
      .catch(() => setEngine(isTauri ? "degraded" : "preview"));
  }, [toast]);

  const analyzePath = useCallback(
    async (path: string) => {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const name = path.split(/[\\/]/).pop() ?? path;
      if (!ACCEPTED_EXT.includes(ext)) {
        toast("error", "Unsupported file", `"${name}" is not a .log or .txt file.`);
        return;
      }
      const id = ++reqId.current;
      setPage("dashboard");
      setLoading(name);
      try {
        const a = await api.analyzeLog(path, thresholdRef.current);
        if (id !== reqId.current) return; // a newer file was dropped meanwhile
        setAnalysis(a);
        saveLastAnalysis(a);
        const found = a.frameSamples + a.shadersCompiled + a.warnCount + a.errorCount;
        if (found === 0) {
          toast("warn", "No known metrics found", `${name}: ${a.lineCount.toLocaleString()} lines read, but no FPS/frame time/shader/WARN/ERROR entries were recognised.`);
        } else {
          toast("success", "Log analyzed", `${name} · ${a.lineCount.toLocaleString()} lines in ${a.parseMs} ms`);
        }
      } catch (e) {
        if (id !== reqId.current) return;
        toast("error", "Could not analyze log", e instanceof Error ? e.message : String(e));
      } finally {
        if (id === reqId.current) setLoading(null);
      }
    },
    [toast],
  );

  // Native drag & drop (Tauri delivers real file paths)
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const un = await getCurrentWebview().onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") setDragging(true);
        else if (p.type === "leave") setDragging(false);
        else if (p.type === "drop") {
          setDragging(false);
          if (p.paths.length > 1) toast("info", "Multiple files dropped", "Only the first file will be analyzed.");
          if (p.paths[0]) analyzePath(p.paths[0]);
        }
      });
      if (disposed) un();
      else unlisten = un;
    })().catch((e) => console.error("drag-drop listener failed", e));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [analyzePath, toast]);

  const resetToDemo = useCallback(() => {
    reqId.current++;
    setLoading(null);
    const d = demoAnalysis();
    setAnalysis(d);
    saveLastAnalysis(null);
  }, []);

  return (
    <div className="flex h-full flex-col bg-black">
      <TitleBar subtitle={SUBTITLES[page]} />
      <div className="flex min-h-0 flex-1">
        <Sidebar page={page} onNavigate={setPage} engine={engine} version={info.version} />
        <main className="grid-bg relative min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="absolute inset-0 overflow-y-auto overflow-x-hidden"
            >
              {page === "dashboard" && (
                <Dashboard
                  analysis={analysis}
                  loading={loading}
                  dragging={dragging}
                  onAnalyzePath={analyzePath}
                  onResetDemo={resetToDemo}
                  version={info.version}
                />
              )}
              {page === "shaders" && <ShaderTracker />}
              {page === "settings" && <SettingsPage info={info} onClearAnalysis={resetToDemo} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
