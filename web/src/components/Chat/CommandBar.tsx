import { useEffect, useRef, useState } from "react";
import { useStore, nextId, type ChatAttachment } from "../../lib/store";
import { wsClient } from "../../lib/ws";
import { mic } from "../../lib/voice";
import { normalizeWakeWord } from "../../lib/wakeWord";
import ImageActions from "./ImageActions";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export default function CommandBar() {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pushChat = useStore((s) => s.pushChat);
  const micEnabled = useStore((s) => s.micEnabled);
  const micMode = useStore((s) => s.micMode);
  const wakeEnabled = useStore((s) => s.wakeEnabled);
  const setWakeEnabled = useStore((s) => s.setWakeEnabled);
  const micStatus = useStore((s) => s.micStatus);
  const wakeWord = useStore((s) => normalizeWakeWord(s.health?.voice?.wake_word));
  const voiceEnabled = useStore((s) => s.voiceEnabled);
  const setVoiceEnabled = useStore((s) => s.setVoiceEnabled);
  const voiceProfile = useStore((s) => s.voiceProfile);
  const connected = useStore((s) => s.connected);
  const pending = useStore((s) => s.pendingAttachments);
  const addAttachment = useStore((s) => s.addAttachment);
  const removeAttachment = useStore((s) => s.removeAttachment);
  const suggestions = useStore((s) => s.suggestions);
  const openSettings = useStore((s) => s.openSettings);
  const openProjects = useStore((s) => s.openProjects);

  const quickActions = [
    { label: "⚡ فحص النظام", cmd: "ما هي حالة موارد النظام واستهلاك الذاكرة والمعالج؟" },
    { label: "📁 المشاريع الـ 27", isProjects: true },
    { label: "🛠️ الأدوات والإضافات", cmd: "ما هي الأدوات والإضافات المفعلة الآن؟" },
    { label: "🧹 مسح الشاشة", isClear: true },
  ];

  const imageAttachments = pending.filter((a) => a.type === "image");
  const hasImages = imageAttachments.length > 0;

  // Auto-resize textarea height
  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  useEffect(() => {
    resizeTextarea();
  }, [value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === "/") || (e.key === "/" && document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "INPUT")) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
      if (e.ctrlKey && e.key === "u") {
        e.preventDefault();
        fileInputRef.current?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    const v = value.trim();
    const st = useStore.getState();
    const hasAtt = st.pendingAttachments.length > 0;
    if (!v && !hasAtt) return;
    if (v.toLowerCase() === "/clear" || v.toLowerCase() === "/cls") {
      st.clearChat();
      setValue("");
      return;
    }
    if (!v.startsWith("/")) {
      pushChat({
        id: nextId(),
        role: "user",
        text: v || (hasAtt ? "(attached)" : ""),
        ts: Date.now(),
        attachments: hasAtt ? [...st.pendingAttachments] : undefined,
      });
    }
    wsClient.chat(v);
    setValue("");
  };

  const sendSuggestion = (text: string) => {
    const t = text.trim();
    if (!t || !connected) return;
    pushChat({ id: nextId(), role: "user", text: t, ts: Date.now() });
    wsClient.chat(t);
    setValue("");
  };

  const toggleMic = async () => {
    if (micEnabled) {
      mic.stop();
      setWakeEnabled(false);
    } else {
      setWakeEnabled(true);
      await mic.start(
        (text, isFinal) => {
          if (isFinal && text.trim()) {
            const trimmed = text.trim();
            pushChat({ id: nextId(), role: "user", text: trimmed, ts: Date.now() });
            wsClient.chat(trimmed);
            setValue("");
          } else {
            setValue(text);
          }
        },
        (phrase) => {
          console.log("wake phrase:", phrase);
          try { (window as any).jarvis?.send?.("jarvis:wake"); } catch { /* noop */ }
        }
      );
    }
  };

  useEffect(() => {
    if (wakeEnabled && !micEnabled && connected) {
      mic.start(
        (text, isFinal) => {
          if (isFinal && text.trim()) {
            const trimmed = text.trim();
            pushChat({ id: nextId(), role: "user", text: trimmed, ts: Date.now() });
            wsClient.chat(trimmed);
            setValue("");
          } else {
            setValue(text);
          }
        },
        (phrase) => {
          console.log("wake phrase:", phrase);
          try { (window as any).jarvis?.send?.("jarvis:wake"); } catch { /* noop */ }
        }
      );
    } else if (!wakeEnabled && micEnabled) {
      mic.stop();
    }
  }, [wakeEnabled, connected]);

  const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) await handleFile(f, addAttachment);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="holo-panel h-full flex flex-col overflow-hidden border border-cyan-500/25 bg-slate-950/90 shadow-2xl backdrop-blur-md rounded-xl">
      {/* ── Attached previews ────────────────────────────────────────── */}
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-2.5 pb-1 shrink-0 bg-slate-900/40 border-b border-cyan-500/15">
          {pending.map((a, i) => (
            <div
              key={i}
              className="group relative flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-xl border border-cyan-500/35 bg-cyan-950/30 hover:border-cyan-400 hover:bg-cyan-950/50 transition-all shadow-sm"
            >
              {a.type === "image" && (a.data_url || a.url) ? (
                <img
                  src={a.data_url || a.url}
                  alt=""
                  className="w-10 h-10 object-cover rounded-lg border border-cyan-500/30 shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg border border-cyan-500/20 bg-cyan-950/20 flex items-center justify-center text-[9px] font-mono text-cyan-400 shrink-0">
                  FILE
                </div>
              )}
              <span className="text-[10px] font-mono text-cyan-200 truncate max-w-[110px]">
                {a.name}
              </span>
              <button
                onClick={() => removeAttachment(i)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-slate-900 border border-rose-500/60 text-rose-400 flex items-center justify-center text-[10px] hover:bg-rose-950 cursor-pointer"
                title="حذف الملف"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Image actions (if any image attached) ───────────────────── */}
      {hasImages && (
        <div className="px-3 pb-1.5 pt-1.5 shrink-0 bg-slate-900/30 border-b border-cyan-500/15">
          <ImageActions images={imageAttachments} />
        </div>
      )}

      {/* ── Quick Action Toolbar ────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-1.5 px-3 pt-2 pb-1 shrink-0 border-b border-cyan-500/10">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {quickActions.map((qa, i) => (
            <button
              key={i}
              onClick={() => {
                if (qa.isProjects) {
                  openProjects();
                } else if (qa.isClear) {
                  useStore.getState().clearChat();
                } else if (qa.cmd) {
                  sendSuggestion(qa.cmd);
                }
              }}
              disabled={!connected}
              className="px-2.5 py-1 rounded-lg border border-cyan-500/20 bg-slate-900/60 hover:bg-cyan-950/40 hover:border-cyan-500/40 text-cyan-300 text-[11px] font-mono transition-all whitespace-nowrap shadow-sm cursor-pointer disabled:opacity-40"
            >
              {qa.label}
            </button>
          ))}
        </div>

        {/* Dynamic Voice Waveform indicator when listening */}
        {(micEnabled || micStatus) && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 text-[10px] font-mono shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            <div className="flex items-center gap-0.5 h-3">
              <span className="w-0.5 h-2 bg-cyan-400 animate-pulse" />
              <span className="w-0.5 h-3 bg-cyan-300 animate-pulse" />
              <span className="w-0.5 h-1.5 bg-cyan-400 animate-pulse" />
            </div>
            <span className="text-[9.5px]">مستمع</span>
          </div>
        )}
      </div>

      {/* ── Suggestions if active ───────────────────────────────────── */}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-1.5 pb-1 shrink-0 bg-cyan-950/20 border-b border-cyan-500/15">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => sendSuggestion(s)}
              disabled={!connected}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-cyan-500/30 bg-cyan-950/40 hover:border-cyan-400 hover:bg-cyan-950/70 text-cyan-200 text-[11px] transition-all cursor-pointer"
            >
              <span className="text-cyan-400 text-[10px]">↳</span>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* ── Main Input Row ──────────────────────────────────────────── */}
      <div className="flex items-end gap-2 px-3 py-2 shrink-0 mt-auto">
        {/* Mic Toggle Button */}
        <button
          onClick={toggleMic}
          title={micEnabled ? `المايكروفون مفعل (${micMode}) - اضغط للتعطيل` : "تفعيل المايكروفون والتحدث"}
          className={`w-9 h-9 flex items-center justify-center rounded-xl border transition-all shrink-0 cursor-pointer ${
            !micEnabled
              ? "border-cyan-500/20 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40 hover:bg-cyan-950/30"
              : micMode === "speaking"
                ? "border-amber-400 text-amber-300 bg-amber-950/30 shadow-[0_0_10px_rgba(251,191,36,0.3)]"
                : "border-cyan-400 text-cyan-300 bg-cyan-950/50 shadow-[0_0_12px_rgba(34,211,238,0.4)] animate-pulse"
          }`}
        >
          <MicIcon active={micEnabled} />
        </button>

        {/* Speaker / Voice output Toggle */}
        <button
          onClick={() => setVoiceEnabled(!voiceEnabled)}
          title={voiceEnabled ? `كتم صوت جارفيس (${voiceProfile?.name ?? "..."})` : `تشغيل صوت جارفيس (${voiceProfile?.name ?? "..."})`}
          className={`w-9 h-9 flex items-center justify-center rounded-xl border transition-all shrink-0 cursor-pointer ${
            voiceEnabled
              ? "border-cyan-500/40 text-cyan-300 bg-cyan-950/30"
              : "border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600"
          }`}
        >
          <SpeakerIcon muted={!voiceEnabled} />
        </button>

        {/* Attachment Upload Button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          title="إرفاق صورة أو ملف (Ctrl+U)"
          className={`w-9 h-9 flex items-center justify-center rounded-xl border transition-all shrink-0 cursor-pointer ${
            hasImages
              ? "border-cyan-400 text-cyan-300 bg-cyan-950/40 shadow-[0_0_8px_rgba(34,211,238,0.3)]"
              : "border-cyan-500/20 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/40 hover:bg-cyan-950/30"
          }`}
        >
          <UploadIcon />
        </button>
        <input ref={fileInputRef} type="file" accept="image/*,*/*" multiple className="hidden" onChange={onFileSelect} />

        {/* Textarea Input Field */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={connected ? "اكتب أمرك لـ JARVIS، أو اسأل عن أي ملف أو خدمة..." : "جارٍ الاتصال بالنظام..."}
            disabled={!connected}
            className="w-full bg-slate-900/80 border border-cyan-500/20 focus:border-cyan-400 outline-none px-3.5 py-[7px] rounded-xl text-slate-100 font-sans text-[13px] placeholder:text-slate-500 backdrop-blur-md transition-all resize-none overflow-hidden leading-[1.5]"
          />
          <span className="absolute right-3 bottom-[8px] text-[10px] font-mono text-cyan-500/40 tabular-nums pointer-events-none">
            {value.length > 0 ? `${value.length}` : "↵ Enter"}
          </span>
        </div>

        {/* Send Button */}
        <button
          onClick={submit}
          disabled={(!value.trim() && pending.length === 0) || !connected}
          className="px-4 h-9 rounded-xl border border-cyan-400 text-cyan-100 bg-gradient-to-r from-cyan-600/30 to-blue-600/30 hover:from-cyan-500/40 hover:to-blue-500/40 hover:border-cyan-300 font-mono text-[11px] uppercase tracking-wider font-semibold disabled:opacity-30 transition-all shadow-[0_0_15px_rgba(34,211,238,0.25)] shrink-0 cursor-pointer"
        >
          إرسال
        </button>
      </div>

      {(wakeEnabled || micStatus) && (
        <div className="px-3 pb-1 text-[10px] font-mono text-cyan-400/60 shrink-0 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block" />
          <span>{micStatus ? `الحالة: ${micStatus}` : `قل كلمة التنبيه "${wakeWord}" للتحدث فوراً`}</span>
        </div>
      )}
    </div>
  );
}

// ── File handling ──────────────────────────────────────────────────────────

async function handleFile(f: File, add: (a: ChatAttachment) => void) {
  const isImage = f.type.startsWith("image/");
  if (isImage && f.size <= MAX_IMAGE_BYTES) {
    const dataUrl = await fileToDataURL(f);
    add({ type: "image", name: f.name, data_url: dataUrl, size: f.size, mime: f.type });
    return;
  }
  const form = new FormData();
  form.append("file", f);
  try {
    const resp = await fetch("/api/upload", { method: "POST", body: form });
    const data = await resp.json();
    if (data?.url) {
      add({ type: isImage ? "image" : "file", name: f.name, url: data.url, data_url: data.data_url || undefined, size: f.size, mime: f.type });
    }
  } catch (e) {
    console.error("upload failed", e);
  }
}

function fileToDataURL(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

// ── Icons ──────────────────────────────────────────────────────────────────

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
      {active && <circle cx="12" cy="9" r="1.5" fill="currentColor" />}
    </svg>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 5L6 9H3v6h3l5 4V5z" />
      {muted ? <path d="M16 9l5 5M21 9l-5 5" /> : <path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14" />}
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
