import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Database, FileDown, FileUp, Pickaxe, Plus, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, CopyButton, SectionTitle, Skeleton, statusColor } from "../components/ui";
import { useToast } from "../components/Toast";
import { api, confirmDialog, copyText, isTauri, notify, pickFile, pickSavePath } from "../lib/api";
import { fmtInt, pct } from "../lib/format";
import { useSettings } from "../lib/settings";
import type { Shader, ShaderPage, ShaderStats } from "../lib/types";

const STAGES = ["All", "Mesh", "Pixel", "Compute", "Vertex", "Geometry", "Hull", "Domain", "Amplification", "Unknown"];
const STATUSES = ["All", "Translated", "Failed", "Pending", "Untested"];

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function ShaderTracker() {
  const toast = useToast();
  const [settings, setSettings] = useSettings();
  const [stage, setStage] = useState("All");
  const [status, setStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ShaderPage | null>(null);
  const [stats, setStats] = useState<ShaderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const debouncedSearch = useDebounced(search, 200);
  const req = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++req.current;
    try {
      const [p, s] = await Promise.all([
        api.queryShaders({ stage, status, search: debouncedSearch, page, pageSize: settings.pageSize }),
        api.shaderStats(),
      ]);
      if (id !== req.current) return;
      setData(p);
      setStats(s);
      if (p.page !== page) setPage(p.page);
    } catch (e) {
      if (id === req.current) toast("error", "Database error", e instanceof Error ? e.message : String(e));
    } finally {
      if (id === req.current) setLoading(false);
    }
  }, [stage, status, debouncedSearch, page, settings.pageSize, toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // reset to first page when filters change
  useEffect(() => setPage(1), [stage, status, debouncedSearch, settings.pageSize]);

  const onRowClick = async (s: Shader) => {
    if (s.status !== "Failed") return;
    const details = `Shader: ${s.hash}\nStage: ${s.stage}\nStatus: ${s.status}\nError Reason: ${s.reason || "—"}`;
    try {
      await copyText(details);
      const sent = settings.notifications ? await notify("AuroraBR", "Shader details copied to clipboard") : false;
      toast("success", "Shader details copied to clipboard", sent ? s.hash : `${s.hash}${settings.notifications && isTauri ? " · (native notification unavailable)" : ""}`);
    } catch (e) {
      toast("error", "Copy failed", String(e));
    }
  };

  const changeStatus = async (s: Shader, next: string) => {
    try {
      const reason = next === "Translated" ? "None" : next === "Pending" && s.reason === "None" ? "Not Attempted" : undefined;
      await api.updateShader(s.hash, next, reason);
      refresh();
    } catch (e) {
      toast("error", "Update failed", e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (s: Shader) => {
    if (!(await confirmDialog(`Remove shader ${s.hash} from the tracker?`))) return;
    try {
      await api.deleteShader(s.hash);
      toast("info", "Shader removed", s.hash);
      refresh();
    } catch (e) {
      toast("error", "Delete failed", String(e));
    }
  };

  const doImport = async () => {
    if (!isTauri) return toast("info", "Desktop only", "Importing files requires the desktop app.");
    try {
      const path = await pickFile("Shader list (CSV / JSON)", ["csv", "json", "txt", "tsv"]);
      if (!path) return;
      setLoading(true);
      const r = await api.importShaders(path);
      toast("success", "Import complete", `${fmtInt(r.inserted)} added · ${fmtInt(r.updated)} updated · ${fmtInt(r.skipped)} skipped (invalid hash)`);
      refresh();
    } catch (e) {
      setLoading(false);
      toast("error", "Import failed", e instanceof Error ? e.message : String(e));
    }
  };

  const doExport = async () => {
    if (!isTauri) return toast("info", "Desktop only", "Exporting files requires the desktop app.");
    try {
      const path = await pickSavePath("AuroraBR_shaders.csv", "CSV", ["csv"]);
      if (!path) return;
      const n = await api.exportShadersCsv(path);
      toast("success", "Exported", `${fmtInt(n)} shaders → ${path}`);
    } catch (e) {
      toast("error", "Export failed", e instanceof Error ? e.message : String(e));
    }
  };

  const percent = stats ? pct(stats.translated, stats.total) : 0;

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-5 p-5 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label text-aurora-orange">Module 02 · Mapa da Mineração</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">Shader Tracker</h1>
          <p className="mt-1 text-xs text-neutral-500">RDNA2 → DXIL translation status · persisted locally in SQLite</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add shader
          </button>
          <button className="btn-ghost" onClick={doImport}>
            <FileUp className="h-4 w-4" /> Import CSV/JSON
          </button>
          <button className="btn-ghost" onClick={doExport}>
            <FileDown className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </div>

      {/* Global progress */}
      <div className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="label">Total Shaders Translated</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-white">
              {stats ? (
                <>
                  <span className="text-aurora-orange">{fmtInt(stats.translated)}</span>
                  <span className="text-neutral-600"> / </span>
                  {fmtInt(stats.total)}
                  <span className="ml-2 text-lg text-neutral-400">({percent}%)</span>
                </>
              ) : (
                <Skeleton className="h-8 w-56" />
              )}
            </div>
          </div>
          {stats && (
            <div className="flex flex-wrap gap-4 font-mono text-xs">
              <Stat color="text-aurora-emerald" label="Translated" v={stats.translated} />
              <Stat color="text-aurora-crimson" label="Failed" v={stats.failed} />
              <Stat color="text-aurora-amber" label="Pending" v={stats.pending} />
              <Stat color="text-neutral-400" label="Untested" v={stats.untested} />
            </div>
          )}
        </div>
        <div className="relative mt-4 h-3 overflow-hidden rounded-full bg-neutral-900">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#FF6B00] to-[#FFB800] shadow-[0_0_18px_rgba(255,107,0,0.6)]"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
          {stats && stats.total > 0 && (
            <motion.div
              className="absolute inset-y-0 bg-aurora-crimson/70"
              initial={{ width: 0 }}
              animate={{ left: `${percent}%`, width: `${pct(stats.failed, stats.total)}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          )}
        </div>
        {stats && (
          <div className="mt-2 flex justify-between font-mono text-[11px] text-neutral-600">
            <span>
              <Database className="mr-1 inline h-3 w-3" />
              {fmtInt(stats.total)} catalogued of {fmtInt(stats.expectedTotal)} expected ({pct(stats.total, stats.expectedTotal)}%)
            </span>
            <span>failed shown in red</span>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <SectionTitle
          icon={<Pickaxe className="h-4 w-4 text-aurora-orange" />}
          title="Shader Database"
          sub={data ? `${fmtInt(data.total)} result(s)` : undefined}
          right={
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-36" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Stage">
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s === "All" ? "Stage: All" : s}
                  </option>
                ))}
              </select>
              <select className="input w-36" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s === "All" ? "Status: All" : s}
                  </option>
                ))}
              </select>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-600" />
                <input className="input w-56 pl-8 font-mono" placeholder="Search by Hash..." value={search} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
                {search && (
                  <button className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white" onClick={() => setSearch("")} aria-label="Clear search">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-neutral-900 text-left">
                <th className="label px-4 py-2.5 font-semibold">Hash</th>
                <th className="label px-4 py-2.5 font-semibold">Stage</th>
                <th className="label px-4 py-2.5 font-semibold">Status</th>
                <th className="label px-4 py-2.5 font-semibold">Error Reason</th>
                <th className="label px-4 py-2.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={5} className="px-4 py-2">
                        <Skeleton className="h-7 w-full" />
                      </td>
                    </tr>
                  ))
                : data?.rows.map((s) => (
                    <tr
                      key={s.hash}
                      onClick={() => onRowClick(s)}
                      title={s.status === "Failed" ? "Click to copy shader details" : undefined}
                      className={`border-b border-neutral-900/70 transition-colors ${s.status === "Failed" ? "cursor-pointer hover:bg-aurora-crimson/[0.06]" : "hover:bg-white/[0.02]"}`}
                    >
                      <td className="selectable px-4 py-2 font-mono text-[13px] text-neutral-100">{s.hash}</td>
                      <td className="px-4 py-2 text-neutral-400">{s.stage}</td>
                      <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                        <StatusSelect value={s.status} onChange={(v) => changeStatus(s, v)} />
                      </td>
                      <td className={`px-4 py-2 font-mono text-xs ${s.status === "Failed" ? "text-aurora-crimson" : "text-neutral-500"}`}>{s.reason || "—"}</td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <CopyButton text={s.hash} label="Copy Hash" />
                          <button className="btn h-8 border border-neutral-800 px-2 text-neutral-500 hover:border-aurora-crimson hover:text-aurora-crimson" onClick={() => remove(s)} title="Remove from tracker" aria-label="Remove">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {data && data.rows.length === 0 && (
            <div className="py-12 text-center text-sm text-neutral-500">
              {data.total === 0 && !search && stage === "All" && status === "All" ? "The tracker is empty — import a CSV/JSON list or send shaders from a log." : "No shaders match the current filters."}
            </div>
          )}
        </div>
        {data && (
          <Pagination
            page={data.page}
            pageCount={data.pageCount}
            total={data.total}
            pageSize={data.pageSize}
            onPage={setPage}
            onPageSize={(n) => setSettings({ pageSize: n })}
          />
        )}
      </div>

      <AnimatePresence>{adding && <AddShaderModal onClose={() => setAdding(false)} onSaved={refresh} />}</AnimatePresence>
    </div>
  );
}

function Stat({ color, label, v }: { color: string; label: string; v: number }) {
  return (
    <div className="text-right">
      <div className={`text-base font-semibold ${color}`}>{fmtInt(v)}</div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</div>
    </div>
  );
}

function StatusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative inline-flex">
      <Badge color={statusColor(value)}>{value}</Badge>
      <select
        className="absolute inset-0 cursor-pointer opacity-0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Change status"
        title="Change status"
      >
        {STATUSES.slice(1).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

function Pagination({ page, pageCount, total, pageSize, onPage, onPageSize }: { page: number; pageCount: number; total: number; pageSize: number; onPage: (p: number) => void; onPageSize: (n: number) => void }) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  for (let i = start; i <= Math.min(pageCount, start + 4); i++) pages.push(i);
  const nb = "flex h-8 min-w-8 items-center justify-center rounded-md px-2 font-mono text-xs transition-colors disabled:opacity-30";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-3 font-mono text-xs text-neutral-500">
        <span>
          {fmtInt(from)}–{fmtInt(to)} of {fmtInt(total)}
        </span>
        <select className="input h-8 w-[104px] text-xs" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page">
          {[25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1">
        <button className={`${nb} text-neutral-400 hover:bg-white/5`} disabled={page <= 1} onClick={() => onPage(1)} aria-label="First page">
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <button className={`${nb} text-neutral-400 hover:bg-white/5`} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p) => (
          <button key={p} className={`${nb} ${p === page ? "bg-aurora-orange font-semibold text-black" : "text-neutral-400 hover:bg-white/5"}`} onClick={() => onPage(p)}>
            {p}
          </button>
        ))}
        <button className={`${nb} text-neutral-400 hover:bg-white/5`} disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
        <button className={`${nb} text-neutral-400 hover:bg-white/5`} disabled={page >= pageCount} onClick={() => onPage(pageCount)} aria-label="Last page">
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function AddShaderModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [hash, setHash] = useState("");
  const [stage, setStage] = useState("Mesh");
  const [status, setStatus] = useState("Untested");
  const [reason, setReason] = useState("");
  const clean = hash.trim().replace(/^0x/i, "");
  const valid = /^[0-9a-fA-F]{4,64}$/.test(clean);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const save = async () => {
    if (!valid) return;
    try {
      const r = await api.trackShaders([{ hash: clean.toLowerCase(), stage, status, reason }]);
      if (r.inserted === 0) {
        toast("warn", "Already tracked", "A shader with this hash already exists.");
        return;
      }
      toast("success", "Shader added", clean.toLowerCase());
      onSaved();
      onClose();
    } catch (e) {
      toast("error", "Could not add shader", String(e));
    }
  };

  return (
    <motion.div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 8 }}
        className="w-[440px] rounded-xl border border-neutral-800 bg-aurora-card p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Add shader</h2>
          <button onClick={onClose} className="text-neutral-500 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="label">Hash</span>
            <input autoFocus className={`input mt-1 w-full font-mono ${hash && !valid ? "border-aurora-crimson" : ""}`} value={hash} onChange={(e) => setHash(e.target.value)} placeholder="4e35b816f2f91d68" spellCheck={false} onKeyDown={(e) => e.key === "Enter" && save()} />
            {hash && !valid && <span className="mt-1 block text-xs text-aurora-crimson">Hex only, 4–64 characters</span>}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Stage</span>
              <select className="input mt-1 w-full" value={stage} onChange={(e) => setStage(e.target.value)}>
                {STAGES.slice(1).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Status</span>
              <select className="input mt-1 w-full" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.slice(1).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="label">Error reason</span>
            <input className="input mt-1 w-full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wave64 Lane Mask" maxLength={300} />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!valid} onClick={save}>
            Add shader
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
