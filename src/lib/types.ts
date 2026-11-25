export interface Kpis {
  fps: number | null;
  frameTime: number | null;
  gpuIdle: number | null;
  copyBackMb: number | null;
}

export interface TimelinePoint {
  t: number;
  frameTime: number;
  gpuIdle: number | null;
}

export interface CompiledShader {
  hash: string;
  stage: string;
  timeMs: number;
  status: string; // "Slow JIT" | "Compiled" | "Failed"
}

export interface LogLine {
  lineNo: number;
  level: "WARN" | "ERROR" | string;
  text: string;
}

export interface Analysis {
  fileName: string;
  filePath: string;
  fileSize: number;
  lineCount: number;
  kpis: Kpis;
  frameSamples: number;
  timeline: TimelinePoint[];
  slowShaders: CompiledShader[];
  allShaders: CompiledShader[];
  shadersCompiled: number;
  logs: LogLine[];
  warnCount: number;
  errorCount: number;
  parseMs: number;
  parsedAt: number;
  isDemo: boolean;
}

export type ShaderStatus = "Translated" | "Failed" | "Pending" | "Untested";

export interface Shader {
  hash: string;
  stage: string;
  status: ShaderStatus | string;
  reason: string;
  updatedAt: number;
}

export interface ShaderQuery {
  stage?: string;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ShaderPage {
  rows: Shader[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface ShaderStats {
  total: number;
  translated: number;
  failed: number;
  pending: number;
  untested: number;
  expectedTotal: number;
}

export interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
}

export interface AppInfo {
  version: string;
  dbPath: string;
  dbWarning: string | null;
}

export type Page = "dashboard" | "shaders" | "settings";
