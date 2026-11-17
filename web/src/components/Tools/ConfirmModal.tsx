import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { useStore } from "../../lib/store";
import { wsClient } from "../../lib/ws";

export default function ConfirmModal() {
  const queue = useStore((s) => s.confirmQueue);
  const pop = useStore((s) => s.popConfirm);
  const top = queue[0];

  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "y") respond(true);
      else if (e.key.toLowerCase() === "n" || e.key === "Escape") respond(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top?.id]);

  const respond = (approved: boolean) => {
    if (!top) return;
    wsClient.confirm(top.id, approved);
    pop(top.id);
  };

  const isDangerous = top?.permission === "dangerous";
  const borderColor = isDangerous ? "rgba(251,113,133,0.5)" : "rgba(251,191,36,0.5)";
  const badgeText = isDangerous ? "DANGEROUS" : "CAUTION";
  const badgeColor = isDangerous ? "text-jarvis-danger" : "text-jarvis-warn";

  return (
    <AnimatePresence>
      {top && (
        <motion.div
          key={top.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{
            background: "rgba(2,6,12,0.72)",
            backdropFilter: "blur(4px)",
          }}
        >
          <motion.div
            initial={{ scale: 0.94, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 10 }}
            className="holo-panel max-w-[480px] w-full mx-4 p-5 relative"
            style={{
              borderColor,
              boxShadow: "0 0 60px rgba(251,113,133,0.15)",
            }}
          >
            <h2 className="text-display text-[12px] tracking-[0.3em] mb-4">
              Permission request <span className="text-jarvis-cyan/50">طلب إذن</span>
            </h2>

            <div className="flex items-center gap-3 mb-3">
              <Badge level={top.permission} />
              <code className="text-mono text-sm text-jarvis-cyan">{top.tool}</code>
            </div>

            <pre className="text-mono text-xs bg-[#030a12] border border-jarvis-cyan/20 p-3 mb-3 break-words whitespace-pre-wrap">
              {top.preview}
            </pre>

            {Object.keys(top.args).length > 0 && (
              <div className="text-mono text-[11px] text-jarvis-cyan/60 mb-3 max-h-32 overflow-y-auto">
                <div className="text-jarvis-cyan/40 mb-1">args:</div>
                <pre className="whitespace-pre-wrap">{JSON.stringify(top.args, null, 2)}</pre>
              </div>
            )}

            <p className="text-sm text-jarvis-cyan/50 mb-4">
              هذه الأداة تعدّل النظام. هل تسمح بتنفيذها؟
            </p>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => respond(false)}
                className="px-4 py-2 border border-jarvis-cyan/30 text-jarvis-cyan text-mono text-xs uppercase tracking-widest hover:bg-jarvis-cyan/10"
              >
                رفض · Deny
              </button>
              <button
                onClick={() => respond(true)}
                className="px-4 py-2 border border-jarvis-cyan text-jarvis-cyan text-mono text-xs uppercase tracking-widest hover:bg-jarvis-cyan/20 font-semibold"
                style={{
                  background: "var(--skin-accent)",
                  borderColor: "var(--skin-accent)",
                  color: "#031018",
                }}
              >
                سماح · Allow
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Badge({ level }: { level: string }) {
  const isDangerous = level === "dangerous";
  const color = isDangerous ? "text-jarvis-danger" : "text-jarvis-warn";
  const borderColor = isDangerous ? "border-jarvis-danger" : "border-jarvis-warn";
  const text = isDangerous ? "DANGEROUS" : "CAUTION";

  return (
    <div className={`text-mono text-[9.5px] uppercase tracking-[0.1em] px-1.5 py-0.5 border ${borderColor} ${color}`}>
      {text}
    </div>
  );
}
