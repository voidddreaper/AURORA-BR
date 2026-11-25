import { useCallback, useEffect, useState } from "react";
import type { Analysis } from "./types";

export interface Settings {
  slowThresholdMs: number;
  notifications: boolean;
  pageSize: number;
}

const DEFAULTS: Settings = { slowThresholdMs: 300, notifications: true, pageSize: 25 };
const KEY = "aurora.settings.v1";
const ANALYSIS_KEY = "aurora.lastAnalysis.v1";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage full or unavailable: non-fatal */
  }
}

export function loadSettings(): Settings {
  try {
    const raw = safeGet(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw);
    return {
      slowThresholdMs: Number.isFinite(p.slowThresholdMs) && p.slowThresholdMs > 0 ? p.slowThresholdMs : DEFAULTS.slowThresholdMs,
      notifications: typeof p.notifications === "boolean" ? p.notifications : DEFAULTS.notifications,
      pageSize: [25, 50, 100].includes(p.pageSize) ? p.pageSize : DEFAULTS.pageSize,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

const listeners = new Set<(s: Settings) => void>();
let current = loadSettings();

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  const update = useCallback((patch: Partial<Settings>) => {
    current = { ...current, ...patch };
    safeSet(KEY, JSON.stringify(current));
    listeners.forEach((l) => l(current));
  }, []);
  return [s, update];
}

export function loadLastAnalysis(): Analysis | null {
  try {
    const raw = safeGet(ANALYSIS_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Analysis;
    if (!a || typeof a !== "object" || !a.kpis || !Array.isArray(a.timeline)) return null;
    a.allShaders ??= a.slowShaders ?? [];
    a.logs ??= [];
    return a;
  } catch {
    return null;
  }
}

export function saveLastAnalysis(a: Analysis | null) {
  if (!a || a.isDemo) {
    safeSet(ANALYSIS_KEY, null);
    return;
  }
  // keep storage small: the full shader list can be huge
  safeSet(ANALYSIS_KEY, JSON.stringify({ ...a, allShaders: a.allShaders.slice(0, 2000) }));
}
