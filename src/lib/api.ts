import type {
  Analysis,
  AppInfo,
  ImportResult,
  Shader,
  ShaderPage,
  ShaderQuery,
  ShaderStats,
} from "./types";
import { MOCK, demoAnalysis } from "./mock";

/** True when running inside the Tauri desktop shell (false in a plain browser preview). */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri) {
    const core = await import("@tauri-apps/api/core");
    try {
      return await core.invoke<T>(cmd, args);
    } catch (e) {
      throw new Error(typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e));
    }
  }
  return browserBackend(cmd, args ?? {}) as Promise<T>;
}

// ---------------------------------------------------------------------------
// Typed API
// ---------------------------------------------------------------------------

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  analyzeLog: (path: string, slowThresholdMs: number) =>
    invoke<Analysis>("analyze_log", { path, slowThresholdMs }),
  queryShaders: (query: ShaderQuery) => invoke<ShaderPage>("query_shaders", { query }),
  shaderStats: () => invoke<ShaderStats>("shader_stats"),
  updateShader: (hash: string, status: string, reason?: string | null) =>
    invoke<Shader>("update_shader", { hash, status, reason: reason ?? null }),
  deleteShader: (hash: string) => invoke<void>("delete_shader", { hash }),
  importShaders: (path: string) => invoke<ImportResult>("import_shaders", { path }),
  trackShaders: (items: Omit<Shader, "updatedAt">[]) =>
    invoke<ImportResult>("track_shaders", { items: items.map((i) => ({ ...i, updatedAt: 0 })) }),
  exportShadersCsv: (path: string) => invoke<number>("export_shaders_csv", { path }),
  resetShaderDemo: () => invoke<void>("reset_shader_demo"),
  clearShaders: () => invoke<void>("clear_shaders"),
  setExpectedTotal: (total: number) => invoke<void>("set_expected_total", { total }),
  saveTextFile: (path: string, contents: string) => invoke<void>("save_text_file", { path, contents }),
  saveBinaryFile: (path: string, contents: Uint8Array) =>
    invoke<void>("save_binary_file", { path, contents: Array.from(contents) }),
};

// ---------------------------------------------------------------------------
// Native helpers with graceful fallbacks
// ---------------------------------------------------------------------------

export async function copyText(text: string): Promise<void> {
  if (isTauri) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return;
    } catch {
      /* fall through to web clipboard */
    }
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

export async function notify(title: string, body: string): Promise<boolean> {
  if (!isTauri) return false;
  try {
    const n = await import("@tauri-apps/plugin-notification");
    let granted = await n.isPermissionGranted();
    if (!granted) granted = (await n.requestPermission()) === "granted";
    if (!granted) return false;
    n.sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}

export async function pickFile(name: string, extensions: string[]): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ multiple: false, directory: false, filters: [{ name, extensions }] });
  return typeof res === "string" ? res : null;
}

export async function pickSavePath(defaultPath: string, name: string, extensions: string[]): Promise<string | null> {
  if (!isTauri) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return (await save({ defaultPath, filters: [{ name, extensions }] })) ?? null;
}

export async function confirmDialog(message: string, title = "AuroraBR"): Promise<boolean> {
  if (!isTauri) return window.confirm(message);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(message, { title, kind: "warning" });
}

/** Browser preview only: trigger a download instead of writing to disk. */
export function browserDownload(filename: string, data: string | Uint8Array, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// In-memory backend for browser preview (mirrors the Rust logic)
// ---------------------------------------------------------------------------

const mem: { shaders: Shader[]; expected: number } = {
  shaders: MOCK.shaderDatabase.map((s) => ({ ...s, updatedAt: Date.now() })),
  expected: 26500,
};

const STATUS_ORDER: Record<string, number> = { Failed: 0, Pending: 1, Untested: 2, Translated: 3 };

async function browserBackend(cmd: string, a: Record<string, any>): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 60));
  switch (cmd) {
    case "app_info":
      return { version: "1.0.0 (preview)", dbPath: "(browser memory)", dbWarning: null } satisfies AppInfo;
    case "analyze_log":
      await new Promise((r) => setTimeout(r, 700));
      return { ...demoAnalysis(), isDemo: false, fileName: String(a.path).split(/[\\/]/).pop() } as Analysis;
    case "query_shaders": {
      const q = a.query as ShaderQuery;
      const s = (q.search ?? "").trim().toLowerCase().replace(/^0x/, "");
      let rows = mem.shaders.filter(
        (r) =>
          (!q.stage || q.stage === "All" || r.stage === q.stage) &&
          (!q.status || q.status === "All" || r.status === q.status) &&
          (!s || r.hash.includes(s) || r.reason.toLowerCase().includes(s)),
      );
      rows = rows.sort((x, y) => (STATUS_ORDER[x.status] ?? 2) - (STATUS_ORDER[y.status] ?? 2) || x.hash.localeCompare(y.hash));
      const pageSize = Math.min(500, Math.max(5, q.pageSize ?? 25));
      const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
      const page = Math.min(pageCount, Math.max(1, q.page ?? 1));
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, pageCount } satisfies ShaderPage;
    }
    case "shader_stats": {
      const c = (st: string) => mem.shaders.filter((r) => r.status === st).length;
      return {
        total: mem.shaders.length,
        translated: c("Translated"),
        failed: c("Failed"),
        pending: c("Pending"),
        untested: mem.shaders.length - c("Translated") - c("Failed") - c("Pending"),
        expectedTotal: mem.expected,
      } satisfies ShaderStats;
    }
    case "update_shader": {
      const row = mem.shaders.find((r) => r.hash === a.hash);
      if (!row) throw new Error(`Shader ${a.hash} not found`);
      row.status = a.status;
      if (a.reason != null) row.reason = a.reason;
      row.updatedAt = Date.now();
      return { ...row };
    }
    case "delete_shader":
      mem.shaders = mem.shaders.filter((r) => r.hash !== a.hash);
      return null;
    case "track_shaders": {
      const res: ImportResult = { inserted: 0, updated: 0, skipped: 0 };
      for (const it of a.items as Shader[]) {
        if (mem.shaders.some((r) => r.hash === it.hash)) res.skipped++;
        else {
          mem.shaders.push({ ...it, updatedAt: Date.now() });
          res.inserted++;
        }
      }
      return res;
    }
    case "reset_shader_demo":
      mem.shaders = MOCK.shaderDatabase.map((s) => ({ ...s, updatedAt: Date.now() }));
      return null;
    case "clear_shaders":
      mem.shaders = [];
      return null;
    case "set_expected_total":
      mem.expected = a.total;
      return null;
    default:
      throw new Error(`"${cmd}" is only available in the desktop app.`);
  }
}
