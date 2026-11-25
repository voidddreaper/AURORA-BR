import type { Kpis } from "./types";

export const fmtNum = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtInt = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("en-US");

export function fmtBytes(n: number): string {
  if (!n) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

export type Tone = "crimson" | "amber" | "orange" | "emerald" | "muted";

export const toneText: Record<Tone, string> = {
  crimson: "text-aurora-crimson",
  amber: "text-aurora-amber",
  orange: "text-aurora-orange",
  emerald: "text-aurora-emerald",
  muted: "text-neutral-500",
};

/** Colour + hint for each KPI, based on common frame pacing thresholds. */
export function kpiTone(kind: keyof Kpis, k: Kpis): { tone: Tone; hint: string } {
  const v = k[kind];
  if (v == null) return { tone: "muted", hint: "Not found in log" };
  switch (kind) {
    case "fps":
      return v < 30 ? { tone: "crimson", hint: "Unplayable (< 30 FPS)" } : v < 55 ? { tone: "amber", hint: "Below 60 FPS target" } : { tone: "emerald", hint: "On target" };
    case "frameTime":
      return v > 33.4 ? { tone: "crimson", hint: "Above 33.3 ms budget" } : v > 16.8 ? { tone: "amber", hint: "Above 16.7 ms budget" } : { tone: "emerald", hint: "Within 60 FPS budget" };
    case "gpuIdle": {
      const ratio = k.frameTime ? v / k.frameTime : 0;
      return ratio >= 0.2 || v > 8
        ? { tone: "orange", hint: `CPU bottleneck · GPU idle ${Math.round(ratio * 100)}% of frame` }
        : { tone: "emerald", hint: "GPU saturated" };
    }
    case "copyBackMb":
      return v >= 16 ? { tone: "orange", hint: "Heavy GPU→CPU readback" } : { tone: "emerald", hint: "Readback OK" };
  }
}
