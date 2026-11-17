/**
 * CHAT PANEL — Futuristic Cyber HUD Dialogue
 *
 * Holographic message cards, formatted multi-language code blocks with 1-click copy,
 * interactive suggestion chips, timestamps, and rich markdown rendering.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore, nextId, type ChatAttachment, type ChatEntry } from "../../lib/store";
import { wsClient } from "../../lib/ws";

export default function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const scrollRef  = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  useEffect(() => {
    if (autoScroll.current) scrollToBottom();
  }, [chat, scrollToBottom]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (autoScroll.current) scrollToBottom();
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  return (
    <div className="holo-panel flex flex-col h-full overflow-hidden border border-cyan-500/25 bg-slate-950/85 shadow-2xl backdrop-blur-md rounded-xl">
      <Header />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-[1.6] text-slate-100"
        style={{
          backgroundImage:
            "radial-gradient(ellipse at top left, rgba(6,182,212,0.06) 0%, transparent 60%), linear-gradient(180deg, rgba(34,211,238,0.02) 0%, rgba(2,6,23,0) 40%)",
        }}
      >
        {chat.length === 0 ? (
          <EmptyState />
        ) : (
          <div ref={contentRef} className="space-y-3 pb-2">
            {chat.map((m) => (
              <MessageCard key={m.id} entry={m} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}

function Header() {
  const clearChat = useStore((s) => s.clearChat);
  const chatLen = useStore((s) => s.chat.length);
  const [copiedAll, setCopiedAll] = useState(false);

  const copyEntireChat = () => {
    const state = useStore.getState();
    const transcript = state.chat
      .map((c) => `[${new Date(c.ts).toLocaleTimeString()}] ${c.role.toUpperCase()}: ${c.text}`)
      .join("\n\n");
    if (!transcript) return;
    navigator.clipboard.writeText(transcript);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <div className="relative flex items-center justify-between px-4 py-2.5 shrink-0 bg-slate-900/60 border-b border-cyan-500/20">
      <div className="flex items-center gap-2.5">
        <div className="relative flex items-center justify-center">
          <div className="w-2 h-2 bg-cyan-400 rounded-full animate-ping absolute opacity-75" />
          <div className="w-2 h-2 bg-cyan-400 rounded-full shadow-[0_0_8px_rgba(34,211,238,0.9)]" />
        </div>
        <span className="text-display text-[11px] tracking-[0.35em] text-cyan-300 font-bold">
          DIALOGUE
        </span>
        <span className="text-mono text-[9px] text-cyan-500/60 tracking-[0.2em] uppercase">
          HUD · STREAM
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        {chatLen > 0 && (
          <>
            <button
              onClick={copyEntireChat}
              className="text-mono text-[10.5px] text-slate-400 hover:text-cyan-300 transition-colors flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 cursor-pointer"
              title="نسخ كامل سجل المحادثة"
            >
              {copiedAll ? <span className="text-emerald-400">✓ تم النسخ</span> : <span>📄 نسخ السجل</span>}
            </button>
            <button
              onClick={() => clearChat()}
              className="text-mono text-[10.5px] text-slate-400 hover:text-rose-400 transition-colors flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800/60 hover:bg-rose-950/40 border border-slate-700/50 cursor-pointer"
              title="مسح سجل المحادثة"
            >
              <span>⟲</span> مسح
            </button>
          </>
        )}
        <span className="text-mono text-[9.5px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
          {chatLen} msg
        </span>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />
    </div>
  );
}

function EmptyState() {
  const pushChat = useStore((s) => s.pushChat);
  const connected = useStore((s) => s.connected);

  const triggerPrompt = (promptText: string) => {
    if (!promptText.trim()) return;
    pushChat({
      id: nextId(),
      role: "user",
      text: promptText,
      ts: Date.now(),
    });
    if (connected) {
      wsClient.chat(promptText);
    }
  };

  const suggestions = [
    { label: "⚡ فحص حالة النظام وموارده", prompt: "ما هي حالة النظام الحالية واستهلاك المعالج والذاكرة؟" },
    { label: "📁 استعراض المشاريع المكتشفة", prompt: "اعرض لي المشاريع الـ 27 المكتشفة في جهازي من قاعدة الذاكرة." },
    { label: "🛠️ قائمة الأدوات والإضافات", prompt: "ما هي الأدوات والإضافات المفعلة في JARVIS الآن؟" },
    { label: "🧠 فحص ملف المضيف والبيئة", prompt: "أخبرني عن مواصفات جهازي وبيئة نظام التشغيل المكتشفة." },
  ];

  return (
    <div className="space-y-4 py-4 animate-fadeIn">
      <div className="flex items-center gap-2.5 p-3 rounded-xl bg-cyan-950/20 border border-cyan-500/25">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 text-sm shadow-[0_0_10px_rgba(6,182,212,0.3)]">
          ⚡
        </div>
        <div>
          <div className="text-[12px] font-bold text-cyan-300">
            J.A.R.V.I.S. READY · FEDORA LINUX WORKSTATION
          </div>
          <div className="text-[11px] text-slate-400">
            النظام جاهز لاستقبال أوامرك بالصوت أو النص. اختر أمراً سريعاً أو اكتب في الأسفل:
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] font-mono tracking-widest text-cyan-400/60 uppercase px-1">
          الأوامر المقترحة السريعة:
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {suggestions.map((item, idx) => (
            <button
              key={idx}
              onClick={() => triggerPrompt(item.prompt)}
              className="group text-left p-2.5 rounded-lg bg-slate-900/60 hover:bg-cyan-950/40 border border-slate-700/60 hover:border-cyan-500/40 transition-all duration-200 flex items-center justify-between gap-2 shadow-sm cursor-pointer"
            >
              <span className="text-[11.5px] text-slate-300 group-hover:text-cyan-200 font-medium">
                {item.label}
              </span>
              <span className="text-cyan-500/40 group-hover:text-cyan-400 text-xs transition-transform group-hover:translate-x-0.5">
                ›
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageCard({ entry }: { entry: ChatEntry }) {
  const { role, text, streaming, attachments, ts } = entry;
  const timeStr = ts
    ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  if (role === "info") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-950/20 border border-cyan-500/20 text-cyan-300/80 text-[11.5px] italic">
        <span className="text-cyan-400 text-xs">ℹ</span>
        <span className="whitespace-pre-wrap">{text}</span>
      </div>
    );
  }

  if (role === "error") {
    return (
      <div className="group relative flex flex-col gap-1.5 p-3 rounded-xl bg-rose-950/30 border border-rose-500/40 text-rose-200 shadow-md">
        <div className="flex items-center justify-between text-[10px] font-mono text-rose-400 border-b border-rose-500/20 pb-1">
          <span className="flex items-center gap-1.5 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            تنبيه النظام · SYSTEM ALERT
          </span>
          <span>{timeStr}</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-[12px] text-rose-100">{text}</div>
      </div>
    );
  }

  if (role === "user") {
    return (
      <div className="group flex flex-col items-end gap-1 animate-boot_in">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-gradient-to-br from-cyan-950/40 to-slate-900/90 border border-cyan-500/30 p-3 shadow-lg">
          <div className="flex items-center justify-between gap-3 text-[10px] font-mono text-cyan-400/70 border-b border-cyan-500/15 pb-1 mb-1.5">
            <span className="font-semibold flex items-center gap-1 text-cyan-300">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              أنت · YOU
            </span>
            <div className="flex items-center gap-2">
              <CopyTextButton text={text} />
              <span>{timeStr}</span>
            </div>
          </div>
          {attachments && attachments.length > 0 && <AttachmentRow atts={attachments} />}
          {text && (
            <div className="text-[12.5px] text-slate-100 whitespace-pre-wrap break-words leading-relaxed font-sans">
              {text}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Assistant (JARVIS)
  return (
    <div className="group flex flex-col items-start gap-1 animate-boot_in">
      <div className="w-full rounded-2xl rounded-tl-sm bg-slate-900/80 border border-cyan-500/30 p-3.5 shadow-xl hover:border-cyan-500/50 transition-colors">
        <div className="flex items-center justify-between text-[10.5px] font-mono text-cyan-400/80 border-b border-cyan-500/20 pb-1.5 mb-2">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 text-[10px] font-bold shadow-[0_0_8px_rgba(34,211,238,0.4)]">
              J
            </div>
            <span className="font-bold text-cyan-300 tracking-wide">J.A.R.V.I.S.</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              ONLINE
            </span>
          </div>
          <div className="flex items-center gap-2">
            <CopyTextButton text={text} />
            <span className="text-slate-400">{timeStr}</span>
          </div>
        </div>

        <div className="text-slate-100/95 leading-relaxed font-sans text-[12.5px]">
          {renderFormattedContent(text)}
          {streaming && (
            <span className="inline-block w-2 h-4 bg-cyan-400/90 ml-1 align-middle animate-pulse rounded-sm shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
          )}
        </div>
      </div>
    </div>
  );
}

function CopyTextButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={handleCopy}
      title="نسخ النص"
      className="opacity-60 hover:opacity-100 text-[10px] text-slate-400 hover:text-cyan-300 px-1.5 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 transition-all flex items-center gap-1 cursor-pointer"
    >
      {copied ? <span className="text-emerald-400">✓ نُسخ</span> : <span>📋 نسخ</span>}
    </button>
  );
}

function CodeBlockCard({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-2.5 rounded-xl border border-cyan-500/30 bg-slate-950/95 overflow-hidden shadow-xl backdrop-blur-md">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-cyan-500/20 text-[10px] font-mono">
        <span className="text-cyan-300 font-semibold uppercase tracking-wider flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
          {lang || "code"}
        </span>
        <button
          onClick={handleCopy}
          className="text-slate-300 hover:text-cyan-200 transition-colors flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800/90 hover:bg-cyan-950/60 border border-cyan-500/30 cursor-pointer shadow-sm"
        >
          {copied ? (
            <span className="text-emerald-400 font-medium">✓ تم نسخ الكود</span>
          ) : (
            <span className="flex items-center gap-1">📋 نسخ الكود</span>
          )}
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-[12px] leading-relaxed font-mono text-cyan-100 whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Parses code blocks with ``` and renders them as CodeBlockCard, delegating rest to inline parser. */
function renderFormattedContent(text: string): React.ReactNode {
  if (!text) return null;

  // Split by code blocks ```lang\ncode```
  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const beforeText = text.slice(lastIndex, match.index);
      parts.push(
        <div key={keyIdx++} className="whitespace-pre-wrap break-words">
          {renderMarkdownLite(beforeText)}
        </div>
      );
    }
    const lang = match[1]?.trim() || "code";
    const code = match[2];
    parts.push(<CodeBlockCard key={keyIdx++} code={code} lang={lang} />);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    // Check if there is an unclosed code block during streaming
    const unclosedIdx = remainingText.indexOf("```");
    if (unclosedIdx !== -1) {
      const textBefore = remainingText.slice(0, unclosedIdx);
      if (textBefore) {
        parts.push(
          <div key={keyIdx++} className="whitespace-pre-wrap break-words">
            {renderMarkdownLite(textBefore)}
          </div>
        );
      }
      const rest = remainingText.slice(unclosedIdx + 3);
      const newlineIdx = rest.indexOf("\n");
      const lang = newlineIdx !== -1 ? rest.slice(0, newlineIdx).trim() : "code";
      const code = newlineIdx !== -1 ? rest.slice(newlineIdx + 1) : rest;
      parts.push(<CodeBlockCard key={keyIdx++} code={code} lang={lang} />);
    } else {
      parts.push(
        <div key={keyIdx++} className="whitespace-pre-wrap break-words">
          {renderMarkdownLite(remainingText)}
        </div>
      );
    }
  }

  return <>{parts}</>;
}

function AttachmentRow({ atts }: { atts: ChatAttachment[] }) {
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {atts.map((a, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-2 py-1 rounded-xl border border-cyan-500/30 bg-cyan-950/30 text-[10.5px] font-mono text-cyan-300"
        >
          {a.type === "image" && (a.data_url || a.url) ? (
            <img
              src={a.data_url || a.url}
              alt=""
              className="w-14 h-14 object-cover rounded-lg border border-cyan-500/40 shadow-sm"
            />
          ) : (
            <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 border border-cyan-500/40 text-[9px] font-bold">
              FILE
            </span>
          )}
          <span className="truncate max-w-[160px] pr-1">{a.name}</span>
        </div>
      ))}
    </div>
  );
}

/** Minimal markdown — bold, inline code, links. */
function renderMarkdownLite(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>()]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(
        <strong key={i++} className="text-cyan-300 font-semibold">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("`")) {
      parts.push(
        <code
          key={i++}
          className="font-mono text-[12px] bg-cyan-950/60 border border-cyan-500/30 px-1.5 py-0.5 rounded text-cyan-200"
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(tok);
      if (mm) {
        parts.push(
          <a
            key={i++}
            href={mm[2]}
            target="_blank"
            rel="noreferrer noopener"
            className="text-cyan-400 underline decoration-cyan-500/40 hover:decoration-cyan-300 hover:text-cyan-200"
          >
            {mm[1]}
          </a>
        );
      } else {
        parts.push(tok);
      }
    } else if (tok.startsWith("http")) {
      parts.push(
        <a
          key={i++}
          href={tok}
          target="_blank"
          rel="noreferrer noopener"
          className="text-cyan-400 underline decoration-cyan-500/40 hover:decoration-cyan-300 break-all"
        >
          {tok}
        </a>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
