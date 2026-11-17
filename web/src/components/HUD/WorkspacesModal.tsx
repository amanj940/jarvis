import { useEffect, useState } from "react";
import { useStore, nextId } from "../../lib/store";
import { wsClient } from "../../lib/ws";

interface ProjectEntity {
  collection: string;
  key: string;
  fields: {
    path?: string;
    description?: string;
    type?: string;
    tags?: string[];
    [key: string]: any;
  };
  tags: string[];
  updated_at: number;
}

export default function WorkspacesModal({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useState<ProjectEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const pushChat = useStore((s) => s.pushChat);
  const connected = useStore((s) => s.connected);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch (e) {
      console.error("Failed to load projects", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const askJarvisAboutProject = (proj: ProjectEntity) => {
    const name = proj.key;
    const path = proj.fields?.path || "";
    const prompt = `اعرض لي تفاصيل مشروع "${name}" الموجود في المسار: ${path}، وافحص بنيته البرمجية وأهم الملفات فيه.`;
    pushChat({
      id: nextId(),
      role: "user",
      text: prompt,
      ts: Date.now(),
    });
    if (connected) {
      wsClient.chat(prompt);
    }
    onClose();
  };

  const copyPath = (path: string, key: string) => {
    navigator.clipboard.writeText(path);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const filtered = projects.filter((p) => {
    const q = search.toLowerCase();
    const keyMatch = p.key.toLowerCase().includes(q);
    const pathMatch = (p.fields?.path || "").toLowerCase().includes(q);
    const tagMatch = p.tags.some((t) => t.toLowerCase().includes(q));
    return keyMatch || pathMatch || tagMatch;
  });

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl border border-cyan-500/30 bg-slate-900/95 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-500/20 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-300 text-lg shadow-[0_0_12px_rgba(6,182,212,0.3)]">
              📁
            </div>
            <div>
              <div className="text-base font-bold text-cyan-200 tracking-wide flex items-center gap-2">
                مشاريع العمل المكتشفة · WORKSPACES
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  {projects.length} مشروع
                </span>
              </div>
              <div className="text-xs text-slate-400">
                مشاريعك البرمجية المفهرسة تلقائياً في قاعدة ذاكرة النظام (SQLite)
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 hover:border-rose-500/50 hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 flex items-center justify-center text-sm transition-colors cursor-pointer"
            title="إغلاق"
          >
            ✕
          </button>
        </div>

        {/* Search & Actions Bar */}
        <div className="p-4 border-b border-cyan-500/15 bg-slate-950/40 flex items-center gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث عن اسم المشروع أو المسار أو اللغة..."
              className="w-full bg-slate-900 border border-cyan-500/20 focus:border-cyan-400 rounded-xl px-4 py-2.5 text-sm text-cyan-100 placeholder:text-slate-500 outline-none transition-all"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>
          <button
            onClick={fetchProjects}
            className="px-4 py-2.5 rounded-xl border border-cyan-500/30 bg-cyan-950/40 hover:bg-cyan-900/40 text-cyan-300 text-xs font-mono font-semibold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            ⟲ تحديث
          </button>
        </div>

        {/* Projects List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3 min-h-[300px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-cyan-400">
              <span className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
              <span className="text-xs font-mono">جارٍ جلب قائمة المشاريع من الذاكرة...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-400 space-y-2">
              <div className="text-3xl">🔍</div>
              <div className="text-sm">لم يتم العثور على أي مشروع يطابق البحث</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filtered.map((proj) => {
                const path = proj.fields?.path || "";
                const isCopied = copiedKey === proj.key;
                return (
                  <div
                    key={proj.key}
                    className="p-4 rounded-xl border border-cyan-500/20 bg-slate-900/50 hover:bg-cyan-950/20 hover:border-cyan-500/40 transition-all flex flex-col justify-between gap-3 shadow-md group"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-sm font-bold text-cyan-200 group-hover:text-cyan-100 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
                          {proj.key}
                        </span>
                        {proj.fields?.type && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-500/20">
                            {proj.fields.type}
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] font-mono text-slate-400 truncate" title={path}>
                        {path || "المسار غير متوفر"}
                      </div>

                      {proj.tags && proj.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {proj.tags.map((t, idx) => (
                            <span
                              key={idx}
                              className="text-[9.5px] font-mono px-1.5 py-0.2 rounded bg-slate-800/80 text-slate-300 border border-slate-700/60"
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                      <button
                        onClick={() => askJarvisAboutProject(proj)}
                        className="flex-1 py-1.5 px-3 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <span>💬 اسأل جارفيس</span>
                      </button>
                      <button
                        onClick={() => copyPath(path, proj.key)}
                        title="نسخ مسار المجلد"
                        className="py-1.5 px-3 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-cyan-200 text-xs font-mono transition-all cursor-pointer"
                      >
                        {isCopied ? "✓ تم" : "📋 المسار"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-cyan-500/15 bg-slate-900/80 flex items-center justify-between text-xs font-mono text-slate-400">
          <span>إجمالي المشاريع المفهرسة: {projects.length}</span>
          <span>اضغط ESC للإغلاق</span>
        </div>
      </div>
    </div>
  );
}
