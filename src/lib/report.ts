import type { Analysis, ShaderStats } from "./types";
import { fmtNum, kpiTone } from "./format";

export function buildJsonReport(a: Analysis, stats: ShaderStats | null, version: string): string {
  const { allShaders, ...rest } = a;
  return JSON.stringify(
    {
      generator: `AuroraBR ${version}`,
      generatedAt: new Date().toISOString(),
      analysis: { ...rest, shaderCount: allShaders.length, shaders: allShaders },
      shaderTracker: stats,
    },
    null,
    2,
  );
}

/** Build a 1–2 page dark-themed PDF report. jsPDF is loaded lazily to keep startup fast. */
export async function buildPdfReport(a: Analysis, stats: ShaderStats | null, version: string): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  const ORANGE: [number, number, number] = [255, 107, 0];
  const RED: [number, number, number] = [255, 51, 51];
  const AMBER: [number, number, number] = [255, 184, 0];
  const GREEN: [number, number, number] = [0, 200, 90];
  const GREY: [number, number, number] = [140, 140, 140];

  const bg = () => {
    doc.setFillColor(0, 0, 0);
    doc.rect(0, 0, W, H, "F");
  };
  const ascii = (s: string) => s.replace(/[^\x20-\x7E -ÿ]/g, "?");
  bg();

  // Header
  doc.setFillColor(...ORANGE);
  doc.rect(0, 0, W, 4, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("AuroraBR", M, 48);
  doc.setTextColor(...ORANGE);
  doc.setFontSize(11);
  doc.text("Log Analysis Report - Salvador", M + 98, 48);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.text(ascii(`File: ${a.fileName}${a.isDemo ? " (demo data)" : ""}`), M, 66);
  doc.text(`Generated: ${new Date().toLocaleString()}  |  AuroraBR ${version}  |  ${a.lineCount.toLocaleString()} lines`, M, 79);

  // KPI cards
  const kpis: [string, keyof Analysis["kpis"], string][] = [
    ["Average FPS", "fps", "FPS"],
    ["Frame Time", "frameTime", "ms"],
    ["GPU Idle Time", "gpuIdle", "ms"],
    ["Copying Back", "copyBackMb", "MB"],
  ];
  const cw = (W - M * 2 - 30) / 4;
  kpis.forEach(([label, key, unit], i) => {
    const x = M + i * (cw + 10);
    const y = 96;
    doc.setFillColor(18, 18, 18);
    doc.setDrawColor(50, 50, 50);
    doc.roundedRect(x, y, cw, 62, 6, 6, "FD");
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(label.toUpperCase(), x + 10, y + 16);
    const tone = kpiTone(key, a.kpis).tone;
    const c = tone === "crimson" ? RED : tone === "amber" ? AMBER : tone === "orange" ? ORANGE : tone === "emerald" ? GREEN : GREY;
    doc.setTextColor(...c);
    doc.setFont("courier", "bold");
    doc.setFontSize(18);
    doc.text(`${fmtNum(a.kpis[key])} ${a.kpis[key] == null ? "" : unit}`, x + 10, y + 44);
    doc.setFont("helvetica", "normal");
  });

  // Timeline chart
  let y = 180;
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Frame Time & GPU Idle (Timeline)", M, y);
  doc.setFont("helvetica", "normal");
  const cx = M, cy = y + 10, chW = W - M * 2, chH = 150;
  doc.setFillColor(12, 12, 12);
  doc.setDrawColor(40, 40, 40);
  doc.rect(cx, cy, chW, chH, "FD");
  const pts = a.timeline;
  if (pts.length > 1) {
    const max = Math.max(1, ...pts.map((p) => Math.max(p.frameTime, p.gpuIdle ?? 0))) * 1.1;
    const px = (i: number) => cx + (i / (pts.length - 1)) * chW;
    const py = (v: number) => cy + chH - (v / max) * chH;
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    for (let g = 0; g <= 4; g++) {
      const v = (max / 4) * g;
      doc.setDrawColor(35, 35, 35);
      doc.line(cx, py(v), cx + chW, py(v));
      doc.text(`${Math.round(v)} ms`, cx + 3, py(v) - 2);
    }
    doc.setLineWidth(1.4);
    doc.setDrawColor(...ORANGE);
    for (let i = 1; i < pts.length; i++) doc.line(px(i - 1), py(pts[i - 1].frameTime), px(i), py(pts[i].frameTime));
    doc.setDrawColor(...RED);
    doc.setLineDashPattern([3, 2], 0);
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1].gpuIdle, p1 = pts[i].gpuIdle;
      if (p0 != null && p1 != null) doc.line(px(i - 1), py(p0), px(i), py(p1));
    }
    doc.setLineDashPattern([], 0);
    doc.setLineWidth(0.5);
  } else {
    doc.setFontSize(9);
    doc.setTextColor(...GREY);
    doc.text("No frame timing samples found in this log.", cx + 12, cy + 20);
  }
  doc.setFontSize(8);
  doc.setTextColor(...ORANGE);
  doc.text("— Frame Time", cx, cy + chH + 14);
  doc.setTextColor(...RED);
  doc.text("- - GPU Idle", cx + 70, cy + chH + 14);

  // Slow shaders table
  y = cy + chH + 40;
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Top ${a.slowShaders.length} Shader Compilation Gargoyles`, M, y);
  y += 14;
  const cols = [M, M + 170, M + 270, M + 380];
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  ["SHADER HASH", "TYPE", "COMPILE TIME", "STATUS"].forEach((h, i) => doc.text(h, cols[i], y));
  doc.setFont("courier", "normal");
  a.slowShaders.forEach((s) => {
    y += 15;
    doc.setTextColor(230, 230, 230);
    doc.text(s.hash, cols[0], y);
    doc.text(s.stage, cols[1], y);
    doc.text(`${fmtNum(s.timeMs, 0)} ms`, cols[2], y);
    doc.setTextColor(...(s.status === "Compiled" ? GREEN : RED));
    doc.text(s.status, cols[3], y);
  });
  if (!a.slowShaders.length) {
    y += 15;
    doc.setTextColor(...GREY);
    doc.text("No shader compilation events found.", cols[0], y);
  }

  // Tracker summary
  if (stats) {
    y += 30;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text("Shader Tracker (RDNA2 -> DXIL)", M, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GREY);
    y += 15;
    const p = stats.total ? Math.round((stats.translated / stats.total) * 100) : 0;
    doc.text(
      `Translated ${stats.translated.toLocaleString()} / ${stats.total.toLocaleString()} (${p}%)  |  Failed ${stats.failed}  |  Pending ${stats.pending}  |  Untested ${stats.untested}`,
      M,
      y,
    );
  }

  // Logs (new page if needed)
  y += 30;
  const ensure = (need: number) => {
    if (y + need > H - M) {
      doc.addPage();
      bg();
      y = M + 10;
    }
  };
  ensure(40);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(`Warnings & Errors (${a.warnCount} WARN · ${a.errorCount} ERROR)`.replace("·", "|"), M, y);
  doc.setFont("courier", "normal");
  doc.setFontSize(7.5);
  for (const l of a.logs.slice(-80)) {
    const lines = doc.splitTextToSize(ascii(`L${l.lineNo} ${l.level.padEnd(5)} ${l.text}`), W - M * 2) as string[];
    ensure(lines.length * 10 + 4);
    y += 11;
    doc.setTextColor(...(l.level === "ERROR" ? RED : AMBER));
    doc.text(lines, M, y);
    y += (lines.length - 1) * 10;
  }
  if (!a.logs.length) {
    y += 12;
    doc.setTextColor(...GREY);
    doc.text("No WARN/ERROR lines.", M, y);
  }

  return new Uint8Array(doc.output("arraybuffer"));
}
