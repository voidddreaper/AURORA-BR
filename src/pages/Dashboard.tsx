import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  Clock,
  Cpu,
  Download,
  FileJson,
  FileText,
  FlaskConical,
  FolderOpen,
  HardDriveDownload,
  ListPlus,
  Search,
  Terminal,
  Upload,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, SectionTitle, Skeleton, statusColor } from "../components/ui";
import { useToast } from "../components/Toast";
import { api, browserDownload, copyText, isTauri, pickFile, pickSavePath } from "../lib/api";
import { fmtBytes, fmtInt, fmtNum, kpiTone, toneText } from "../lib/format";
import { buildJsonReport, buildPdfReport } from "../lib/report";
import type { Analysis, Kpis } from "../lib/types";

interface Props {
  analysis: Analysis;
  loading: string | null;
  dragging: boolean;
  onAnalyzePath: (p: string) => void;
  onResetDemo: () => void;
  version: string;
}

export default function Dashboard({ analysis: a, loading, dragging, onAnalyzePath, onResetDemo, version }: Props) {
  const toast = useToast();

  const browse = async () => {
    if (!isTauri) {
      toast("info", "Desktop only", "File access requires the AuroraBR desktop app.");
      return;
    }
    try {
      const p = await pickFile("VIctory logs", ["log", "txt"]);
      if (p) onAnalyzePath(p);
    } catch (e) {
      toast("error", "Could not open file dialog", String(e));
    }
  };

  const trackShaders = async () => {
    if (!a.allShaders.length) {
      toast("info", "No shaders in this log", "Nothing to add to the tracker.");
      return;
    }
    try {
      const r = await api.trackShaders(
        a.allShaders.map((s) => ({
          hash: s.hash,
          stage: s.stage,
          status: s.status === "Failed" ? "Failed" : "Untested",
          reason: s.status === "Failed" ? "Failed during JIT (from log)" : "",
        })),
      );
      toast("success", "Shader Tracker updated", `${r.inserted} new shader(s) added · ${r.skipped} already tracked`);
    } catch (e) {
      toast("error", "Could not update tracker", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 p-5 lg:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="label text-aurora-orange">Module 01 · Salvador</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Log Analyzer</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-neutral-500">
            <FileText className="h-3.5 w-3.5" />
            <span className="max-w-[420px] truncate text-neutral-300" title={a.filePath || a.fileName}>
              {a.fileName}
            </span>
            {a.isDemo ? (
              <Badge color="amber">DEMO DATA</Badge>
            ) : (
              <>
                <span>·</span>
                <span>{fmtBytes(a.fileSize)}</span>
                <span>·</span>
                <span>{fmtInt(a.lineCount)} lines</span>
                <span>·</span>
                <span>parsed in {a.parseMs} ms</span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={browse} disabled={!!loading}>
            <FolderOpen className="h-4 w-4" /> Open log
          </button>
          <button className="btn-ghost" onClick={trackShaders} disabled={!!loading || a.isDemo} title={a.isDemo ? "Load a real log first" : "Add every shader from this log to the tracker"}>
            <ListPlus className="h-4 w-4" /> Send to Tracker
          </button>
          {!a.isDemo && (
            <button className="btn-ghost" onClick={onResetDemo} disabled={!!loading}>
              <FlaskConical className="h-4 w-4" /> Demo data
            </button>
          )}
          <ExportMenu analysis={a} version={version} disabled={!!loading} />
        </div>
      </div>

      <DropZone dragging={dragging} loading={loading} onBrowse={browse} />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard label="Average FPS" kind="fps" unit="FPS" icon={<Activity className="h-4 w-4" />} kpis={a.kpis} loading={!!loading} />
        <KpiCard label="Frame Time" kind="frameTime" unit="ms" icon={<Clock className="h-4 w-4" />} kpis={a.kpis} loading={!!loading} />
        <KpiCard label="GPU Idle Time" kind="gpuIdle" unit="ms" icon={<Cpu className="h-4 w-4" />} kpis={a.kpis} loading={!!loading} />
        <KpiCard label="Copying Back" kind="copyBackMb" unit="MB" icon={<HardDriveDownload className="h-4 w-4" />} kpis={a.kpis} loading={!!loading} />
      </div>

      <TimelineChart analysis={a} loading={!!loading} />

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
        <GargoyleTable analysis={a} loading={!!loading} />
        <ErrorPanel analysis={a} loading={!!loading} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DropZone({ dragging, loading, onBrowse }: { dragging: boolean; loading: string | null; onBrowse: () => void }) {
  return (
    <motion.div
      onClick={loading ? undefined : onBrowse}
      animate={{ scale: dragging ? 1.01 : 1 }}
      className={`relative flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed px-6 py-6 text-center transition-colors ${
        dragging
          ? "border-aurora-orange bg-aurora-orange/10 shadow-glow"
          : "border-neutral-800 bg-aurora-card/60 hover:border-aurora-orange/70 hover:bg-aurora-orange/[0.03]"
      }`}
    >
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div key="l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-aurora-orange/20 border-t-aurora-orange" />
            <div className="text-sm text-neutral-300">
              Parsing <span className="font-mono text-aurora-orange">{loading}</span> in the Rust engine…
            </div>
          </motion.div>
        ) : (
          <motion.div key="i" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-2">
            <div className={`flex h-11 w-11 items-center justify-center rounded-full border ${dragging ? "border-aurora-orange bg-aurora-orange/20" : "border-neutral-800 bg-black"}`}>
              <Upload className={`h-5 w-5 ${dragging ? "text-aurora-orange" : "text-neutral-400"}`} />
            </div>
            <div className="text-sm font-medium text-neutral-200">
              {dragging ? "Release to analyze" : (
                <>
                  Drag and drop your VIctory <code className="font-mono text-aurora-orange">.log</code> or{" "}
                  <code className="font-mono text-aurora-orange">.txt</code> file here
                </>
              )}
            </div>
            <div className="text-xs text-neutral-500">or click to browse · parsed locally, nothing leaves your machine</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function KpiCard({ label, kind, unit, icon, kpis, loading }: { label: string; kind: keyof Kpis; unit: string; icon: React.ReactNode; kpis: Kpis; loading: boolean }) {
  const { tone, hint } = kpiTone(kind, kpis);
  const v = kpis[kind];
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        <span className="text-neutral-600">{icon}</span>
      </div>
      {loading ? (
        <>
          <Skeleton className="mt-3 h-9 w-32" />
          <Skeleton className="mt-2 h-3 w-40" />
        </>
      ) : (
        <>
          <div className={`mt-2 font-mono text-[32px] font-semibold leading-none ${toneText[tone]}`}>
            {fmtNum(v)}
            {v != null && <span className="ml-1.5 text-base font-normal text-neutral-500">{unit}</span>}
          </div>
          <div className={`mt-2 flex items-center gap-1.5 text-xs ${tone === "muted" ? "text-neutral-600" : "text-neutral-400"}`}>
            {(tone === "crimson" || tone === "orange") && <AlertTriangle className={`h-3 w-3 ${toneText[tone]}`} />}
            {hint}
          </div>
        </>
      )}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-neutral-800 bg-black/95 px-3 py-2 font-mono text-xs shadow-xl">
      <div className="mb-1 text-neutral-500">sample #{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value == null ? "—" : `${fmtNum(p.value)} ms`}
        </div>
      ))}
    </div>
  );
}

function TimelineChart({ analysis: a, loading }: { analysis: Analysis; loading: boolean }) {
  const hasIdle = a.timeline.some((p) => p.gpuIdle != null);
  return (
    <div className="card overflow-hidden">
      <SectionTitle
        icon={<Activity className="h-4 w-4 text-aurora-orange" />}
        title="Frame Time & GPU Idle (Timeline)"
        sub={a.frameSamples ? `${fmtInt(a.frameSamples)} samples${a.frameSamples > a.timeline.length ? ` · averaged to ${a.timeline.length} points` : ""}` : undefined}
      />
      <div className="h-[300px] p-3 pr-5">
        {loading ? (
          <Skeleton className="h-full w-full" />
        ) : a.timeline.length < 2 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-neutral-500">
            <Activity className="h-6 w-6 text-neutral-700" />
            No frame timing samples found in this log.
            <span className="font-mono text-xs text-neutral-600">expected lines like “Frame time: 16.6 ms | GPU idle: 2.1 ms”</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={a.timeline} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" stroke="#525252" tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={{ stroke: "#262626" }} minTickGap={40} />
              <YAxis stroke="#525252" tick={{ fontSize: 11, fontFamily: "JetBrains Mono" }} tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => `${v} ms`} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#FF6B00", strokeOpacity: 0.3 }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} iconType="plainline" />
              <ReferenceLine y={33.3} stroke="#FFB800" strokeOpacity={0.35} strokeDasharray="2 4" />
              <Line type="monotone" name="Frame Time" dataKey="frameTime" stroke="#FF6B00" strokeWidth={2} dot={false} isAnimationActive={a.timeline.length < 400} />
              {hasIdle && (
                <Line type="monotone" name="GPU Idle" dataKey="gpuIdle" stroke="#FF3333" strokeWidth={1.6} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={a.timeline.length < 400} />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function GargoyleTable({ analysis: a, loading }: { analysis: Analysis; loading: boolean }) {
  const toast = useToast();
  return (
    <div className="card flex flex-col overflow-hidden">
      <SectionTitle
        icon={<Zap className="h-4 w-4 text-aurora-orange" />}
        title="Top 10 Shader Compilation Gargoyles"
        sub={a.shadersCompiled ? `${fmtInt(a.allShaders.length)} unique · ${fmtInt(a.shadersCompiled)} compile events` : undefined}
      />
      <div className="min-h-[200px] flex-1 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-900 text-left">
              <th className="label px-4 py-2.5 font-semibold">Shader Hash</th>
              <th className="label px-4 py-2.5 font-semibold">Type</th>
              <th className="label px-4 py-2.5 text-right font-semibold">Compile Time</th>
              <th className="label px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={4} className="px-4 py-2">
                      <Skeleton className="h-6 w-full" />
                    </td>
                  </tr>
                ))
              : a.slowShaders.map((s) => {
                  const max = a.slowShaders[0]?.timeMs || 1;
                  return (
                    <tr
                      key={s.hash}
                      className="group cursor-pointer border-b border-neutral-900/70 transition-colors hover:bg-aurora-orange/[0.04]"
                      onClick={async () => {
                        await copyText(s.hash);
                        toast("success", "Hash copied", s.hash);
                      }}
                      title="Click to copy hash"
                    >
                      <td className="selectable px-4 py-2.5 font-mono text-[13px] text-neutral-200 group-hover:text-aurora-orange">{s.hash}</td>
                      <td className="px-4 py-2.5 text-neutral-400">{s.stage}</td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        <div className="flex items-center justify-end gap-2">
                          <div className="hidden h-1 w-16 overflow-hidden rounded bg-neutral-900 sm:block">
                            <div className="h-full bg-aurora-orange" style={{ width: `${Math.max(4, (s.timeMs / max) * 100)}%` }} />
                          </div>
                          <span className={s.status === "Compiled" ? "text-neutral-300" : "text-aurora-crimson"}>{fmtNum(s.timeMs, 0)} ms</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge color={statusColor(s.status)}>{s.status}</Badge>
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
        {!loading && !a.slowShaders.length && (
          <div className="flex flex-col items-center justify-center gap-1 py-10 text-sm text-neutral-500">
            No shader compilation events found.
            <span className="font-mono text-xs text-neutral-600">expected: “Shader compiled hash=4e35b816f2f91d68 stage=Mesh time=405 ms”</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorPanel({ analysis: a, loading }: { analysis: Analysis; loading: boolean }) {
  const toast = useToast();
  const [level, setLevel] = useState<"ALL" | "WARN" | "ERROR">("ALL");
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return a.logs.filter((l) => (level === "ALL" || l.level === level) && (!needle || l.text.toLowerCase().includes(needle)));
  }, [a.logs, level, q]);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const copyAll = async () => {
    if (!lines.length) return;
    const text = lines.map((l) => `[L${l.lineNo}] ${l.level.padEnd(5)} ${l.text}`).join("\n");
    await copyText(text);
    toast("success", "Error trace copied", `${lines.length} line(s) copied to clipboard`);
  };

  return (
    <div className="card flex flex-col overflow-hidden">
      <SectionTitle
        icon={<Terminal className="h-4 w-4 text-aurora-orange" />}
        title="Error Filter"
        sub={`${fmtInt(a.warnCount)} WARN · ${fmtInt(a.errorCount)} ERROR${a.warnCount + a.errorCount > a.logs.length ? ` · last ${a.logs.length} shown` : ""}`}
        right={
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-neutral-800 text-[11px] font-semibold">
              {(["ALL", "WARN", "ERROR"] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLevel(l)}
                  className={`px-2.5 py-1.5 transition-colors ${
                    level === l ? (l === "ERROR" ? "bg-aurora-crimson/20 text-aurora-crimson" : l === "WARN" ? "bg-aurora-amber/15 text-aurora-amber" : "bg-aurora-orange/15 text-aurora-orange") : "text-neutral-500 hover:text-neutral-200"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            <button className="btn-ghost h-8 px-2.5 text-xs" onClick={copyAll} disabled={!lines.length}>
              <CopyIconInline /> Copy to Clipboard
            </button>
          </div>
        }
      />
      <div className="flex items-center gap-2 border-b border-neutral-900 bg-black px-3 py-1.5">
        <Search className="h-3.5 w-3.5 text-neutral-600" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filter…" className="h-7 flex-1 bg-transparent font-mono text-xs text-neutral-200 outline-none placeholder:text-neutral-700" />
      </div>
      <div ref={boxRef} className="selectable h-[260px] overflow-auto bg-[#050505] p-3 font-mono text-[12px] leading-relaxed">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : lines.length ? (
          lines.map((l, i) => (
            <div key={`${l.lineNo}-${i}`} className="flex gap-3 whitespace-pre-wrap break-all hover:bg-white/[0.03]">
              <span className="w-14 shrink-0 select-none text-right text-neutral-700">{l.lineNo}</span>
              <span className={`w-12 shrink-0 font-semibold ${l.level === "ERROR" ? "text-aurora-crimson" : "text-aurora-amber"}`}>{l.level}</span>
              <span className="text-neutral-300">{l.text}</span>
            </div>
          ))
        ) : (
          <div className="text-neutral-600">
            <span className="text-aurora-emerald">$</span> no {level === "ALL" ? "WARN/ERROR" : level} lines{q ? " matching filter" : ""} ✓
          </div>
        )}
      </div>
    </div>
  );
}

const CopyIconInline = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="14" height="14" x="8" y="8" rx="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);

function ExportMenu({ analysis, version, disabled }: { analysis: Analysis; version: string; disabled: boolean }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);

  const base = (analysis.fileName || "report").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_");

  const run = async (kind: "json" | "pdf") => {
    setOpen(false);
    setBusy(true);
    try {
      const stats = await api.shaderStats().catch(() => null);
      const filename = `AuroraBR_${base}.${kind}`;
      if (kind === "json") {
        const json = buildJsonReport(analysis, stats, version);
        if (!isTauri) return browserDownload(filename, json, "application/json");
        const path = await pickSavePath(filename, "JSON report", ["json"]);
        if (!path) return;
        await api.saveTextFile(path, json);
        toast("success", "Report exported", path);
      } else {
        const bytes = await buildPdfReport(analysis, stats, version);
        if (!isTauri) return browserDownload(filename, bytes, "application/pdf");
        const path = await pickSavePath(filename, "PDF report", ["pdf"]);
        if (!path) return;
        await api.saveBinaryFile(path, bytes);
        toast("success", "Report exported", path);
      }
    } catch (e) {
      toast("error", "Export failed", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button className="btn-primary" disabled={disabled || busy} onClick={() => setOpen((o) => !o)}>
        <Download className="h-4 w-4" /> {busy ? "Exporting…" : "Export Report"} <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 z-30 mt-2 w-52 overflow-hidden rounded-lg border border-neutral-800 bg-[#0d0d0d] shadow-2xl"
          >
            <button className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-neutral-200 hover:bg-aurora-orange/10" onClick={() => run("pdf")}>
              <FileText className="h-4 w-4 text-aurora-orange" /> PDF report
            </button>
            <button className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-neutral-200 hover:bg-aurora-orange/10" onClick={() => run("json")}>
              <FileJson className="h-4 w-4 text-aurora-orange" /> JSON data
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

