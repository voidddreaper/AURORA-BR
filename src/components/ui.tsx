import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { copyText } from "../lib/api";

const BADGE: Record<string, string> = {
  red: "border-aurora-crimson/40 bg-aurora-crimson/10 text-aurora-crimson",
  green: "border-aurora-emerald/30 bg-aurora-emerald/10 text-aurora-emerald",
  amber: "border-aurora-amber/40 bg-aurora-amber/10 text-aurora-amber",
  orange: "border-aurora-orange/40 bg-aurora-orange/10 text-aurora-orange",
  grey: "border-neutral-700 bg-neutral-800/50 text-neutral-400",
};

export function statusColor(status: string): keyof typeof BADGE {
  switch (status) {
    case "Translated":
    case "Compiled":
      return "green";
    case "Failed":
    case "Slow JIT":
      return "red";
    case "Pending":
      return "amber";
    default:
      return "grey";
  }
}

export function Badge({ color, children }: { color: keyof typeof BADGE; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-semibold ${BADGE[color]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function CopyButton({ text, label, onCopied }: { text: string; label?: string; onCopied?: () => void }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      className={`btn h-8 border px-2.5 text-xs ${done ? "border-aurora-emerald/50 text-aurora-emerald" : "border-neutral-800 text-neutral-300 hover:border-aurora-orange hover:text-white"}`}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await copyText(text);
          setDone(true);
          onCopied?.();
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setDone(false), 1400);
        } catch {
          /* ignore */
        }
      }}
      title={`Copy ${text}`}
    >
      <span className="relative h-3.5 w-3.5">
        <AnimatePresence initial={false} mode="wait">
          {done ? (
            <motion.span key="ok" className="absolute inset-0" initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }}>
              <Check className="h-3.5 w-3.5" />
            </motion.span>
          ) : (
            <motion.span key="cp" className="absolute inset-0" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
              <Copy className="h-3.5 w-3.5" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      {label && <span>{done ? "Copied" : label}</span>}
    </button>
  );
}

export function SectionTitle({ icon, title, right, sub }: { icon?: ReactNode; title: string; right?: ReactNode; sub?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-900 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {icon}
        <h3 className="text-sm font-semibold text-neutral-100">{title}</h3>
        {sub && <span className="truncate font-mono text-[11px] text-neutral-500">{sub}</span>}
      </div>
      {right}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-lg bg-neutral-900 ${className}`}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
    </div>
  );
}
