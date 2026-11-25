import type { Analysis, Shader, TimelinePoint } from "./types";

/** Mock data from the product brief, used on first launch and in browser preview. */
export const MOCK = {
  kpis: { fps: 2.1, frameTime: 476.2, gpuIdle: 183.4, copyBackMb: 46.8 },
  slowShaders: [
    { hash: "4e35b816f2f91d68", stage: "Mesh", timeMs: 405, status: "Slow JIT" },
    { hash: "b3ba0ef9ee352720", stage: "Pixel", timeMs: 312, status: "Slow JIT" },
    { hash: "0750cb2d975c7563", stage: "Mesh", timeMs: 280, status: "Compiled" },
  ],
  shaderDatabase: [
    { hash: "7f99b1cc7ccb0f1b", stage: "Vertex", status: "Failed", reason: "Wave64 Lane Mask" },
    { hash: "baa527de08d002bf", stage: "Compute", status: "Failed", reason: "64-bit Image Atomics" },
    { hash: "ee78da6862364ddd", stage: "Pixel", status: "Translated", reason: "None" },
    { hash: "50946a822ac6272b", stage: "Mesh", status: "Translated", reason: "None" },
    { hash: "87274f3b3e819604", stage: "Mesh", status: "Pending", reason: "Not Attempted" },
  ] as Omit<Shader, "updatedAt">[],
};

/** Deterministic pseudo-random generator so the demo chart is stable between launches. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function demoTimeline(): TimelinePoint[] {
  const r = rng(42);
  const pts: TimelinePoint[] = [];
  for (let i = 0; i < 120; i++) {
    const spike = i % 23 === 7 ? 260 : 0;
    const ft = 430 + r() * 90 + spike + Math.sin(i / 6) * 25;
    const idle = 150 + r() * 65 + spike * 0.55 + Math.cos(i / 9) * 12;
    pts.push({ t: i, frameTime: Math.round(ft * 10) / 10, gpuIdle: Math.round(idle * 10) / 10 });
  }
  return pts;
}

export function demoAnalysis(): Analysis {
  return {
    fileName: "demo-session.log",
    filePath: "",
    fileSize: 0,
    lineCount: 18234,
    kpis: { ...MOCK.kpis },
    frameSamples: 120,
    timeline: demoTimeline(),
    slowShaders: MOCK.slowShaders.map((s) => ({ ...s })),
    allShaders: MOCK.slowShaders.map((s) => ({ ...s })),
    shadersCompiled: 3,
    logs: [
      { lineNo: 1204, level: "WARN", text: "[GPU] Wave64 lane mask emulated via ballot fallback — shader 7f99b1cc7ccb0f1b" },
      { lineNo: 1311, level: "ERROR", text: "[DXIL] Translation failed for baa527de08d002bf: 64-bit image atomics not supported by target" },
      { lineNo: 2240, level: "WARN", text: "[JIT] Shader 4e35b816f2f91d68 (Mesh) compiled in 405 ms — stalls frame pacing" },
      { lineNo: 2245, level: "WARN", text: "[JIT] Shader b3ba0ef9ee352720 (Pixel) compiled in 312 ms" },
      { lineNo: 4018, level: "WARN", text: "[MEM] Copying back 46.8 MB from GPU to CPU per frame (readback heap)" },
      { lineNo: 5120, level: "ERROR", text: "[CPU] Command processor stalled 183 ms waiting for fence 0x2f1" },
      { lineNo: 7733, level: "WARN", text: "[SYNC] GPU idle 183.4 ms avg — CPU-bound submission thread" },
    ],
    warnCount: 5,
    errorCount: 2,
    parseMs: 0,
    parsedAt: Date.now(),
    isDemo: true,
  };
}
