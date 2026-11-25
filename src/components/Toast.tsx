import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Kind = "success" | "error" | "info" | "warn";
interface ToastItem {
  id: number;
  kind: Kind;
  title: string;
  body?: string;
}

const Ctx = createContext<(kind: Kind, title: string, body?: string) => void>(() => {});

export const useToast = () => useContext(Ctx);

const ICON = { success: CheckCircle2, error: XCircle, info: Info, warn: AlertTriangle };
const COLOR = {
  success: "text-aurora-emerald",
  error: "text-aurora-crimson",
  info: "text-aurora-orange",
  warn: "text-aurora-amber",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const push = useCallback((kind: Kind, title: string, body?: string) => {
    const id = nextId.current++;
    setItems((x) => [...x.slice(-3), { id, kind, title, body }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 6500 : 3200);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-80 flex-col gap-2">
        <AnimatePresence>
          {items.map((t) => {
            const I = ICON[t.kind];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: 40, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40 }}
                transition={{ duration: 0.18 }}
                className="pointer-events-auto flex gap-3 rounded-lg border border-neutral-800 bg-[#111]/95 p-3 shadow-2xl backdrop-blur"
                onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}
              >
                <I className={`mt-0.5 h-4 w-4 shrink-0 ${COLOR[t.kind]}`} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-100">{t.title}</div>
                  {t.body && <div className="mt-0.5 break-words text-xs text-neutral-400">{t.body}</div>}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
