import { useStore, type ToolCall } from "../../lib/store";

export default function ToolFeed() {
  const tools = useStore((s) => s.tools);
  const recent = [...tools].reverse().slice(0, 10);

  return (
    <div className="holo-panel p-3 flex flex-col">
      <div className="flex items-center justify-between px-1 pb-2 border-b border-jarvis-cyan/20">
        <div className="text-display text-[10px] tracking-[0.3em] text-jarvis-cyan/80">TOOL FEED</div>
        <div className="text-mono text-[10px] text-jarvis-cyan/50">سجل الأدوات</div>
      </div>
      <ul className="space-y-2 overflow-y-auto max-h-[40vh] pr-1 mt-2">
        {recent.length === 0 ? (
          <div className="text-mono text-[11px] text-jarvis-cyan/40 px-1 py-2">no tool activity</div>
        ) : (
          recent.map((t) => <Card key={t.id} t={t} />)
        )}
      </ul>
    </div>
  );
}

function Card({ t }: { t: ToolCall }) {
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

  const badgeClass =
    t.permission === "dangerous" ? "border-jarvis-danger text-jarvis-danger" :
    t.permission === "caution"   ? "border-jarvis-warn text-jarvis-warn"   :
                                      "border-jarvis-ok text-jarvis-ok";

  const statusClass =
    t.status === "running" ? "text-jarvis-warn" :
    t.status === "ok"      ? "text-jarvis-ok" :
    t.status === "denied"  ? "text-jarvis-danger" :
                             "text-jarvis-cyan/50";

  const statusText = t.status === "running" ? "RUNNING" :
                     t.status === "ok"      ? "OK" :
                     t.status === "denied"  ? "DENIED" :
                                              "PROPOSED";

  return (
    <li className={`grid grid-cols-[auto_1fr_auto] gap-2 items-center text-[12px] ${t.status === "running" ? "running" : ""} ${t.status === "ok" ? "ok" : ""} ${t.status === "denied" ? "denied" : ""}`}>
      <span className="w-2 h-2 rounded-full bg-jarvis-ok" />
      <span className="text-mono font-medium text-[11.5px] text-jarvis-cyan overflow-hidden text-ellipsis whitespace-nowrap">{t.tool}</span>
      <span className={`text-mono text-[10.5px] ${statusClass}`}>{statusText}</span>
      {t.preview && (
        <span className="col-span-3 text-[11.5px] text-jarvis-cyan/60 overflow-hidden text-ellipsis whitespace-nowrap">
          {t.preview}
        </span>
      )}
      {t.duration_s != null && t.status !== "running" && (
        <span className="col-span-3 text-[11.5px] text-jarvis-cyan/50 overflow-hidden text-ellipsis whitespace-nowrap">
          OK · {t.duration_s.toFixed(2)}s
        </span>
      )}
    </li>
  );
}
