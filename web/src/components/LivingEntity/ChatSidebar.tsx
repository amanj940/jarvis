import React, { useState, useRef, useEffect, useMemo } from "react";
import { useStore, type ChatEntry } from "../../lib/store";
import { speak, stopSpeaking } from "../../lib/voice";

// ── Markdown & Block Parsers ──────────────────────────────────────────────────

interface CodeBlock {
  type: "code";
  lang: string;
  code: string;
}

interface TextBlock {
  type: "text";
  text: string;
}

type ParsedBlock = CodeBlock | TextBlock;

function parseMessageBlocks(rawText: string): {
  thoughtText: string | null;
  blocks: ParsedBlock[];
} {
  let raw = rawText || "";

  // 1. Extract thought blocks
  let thoughtText: string | null = null;
  const thoughtMatch = raw.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  if (thoughtMatch) {
    const trimmed = thoughtMatch[1].trim();
    if (trimmed) thoughtText = trimmed;
    raw = raw.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
  } else {
    raw = raw.replace(/<\/?thinking>/gi, "").trim();
  }

  // 2. Clean tool tags
  raw = raw
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<tool_result>[\s\S]*?<\/tool_result>/gi, "")
    .replace(/<tool_calls>[\s\S]*?<\/tool_calls>/gi, "")
    .trim();

  // 3. Extract code blocks ```...```
  const blocks: ParsedBlock[] = [];
  const codeRegex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeRegex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      const textPart = raw.slice(lastIndex, match.index).trim();
      if (textPart) blocks.push({ type: "text", text: textPart });
    }
    blocks.push({
      type: "code",
      lang: match[1]?.trim().toLowerCase() || "",
      code: match[2]?.trim() || "",
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < raw.length) {
    const remaining = raw.slice(lastIndex).trim();
    if (remaining) blocks.push({ type: "text", text: remaining });
  }

  if (blocks.length === 0 && raw) {
    blocks.push({ type: "text", text: raw });
  }

  return { thoughtText, blocks };
}

function renderInlineMarkdown(str: string): React.ReactNode {
  const codeParts = str.split(/(`[^`]+`)/g);
  return codeParts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="mx-0.5 px-1.5 py-0.5 rounded bg-cyan-950/70 border border-cyan-500/30 text-cyan-300 font-mono text-[10.5px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((bPart, j) => {
      if (bPart.startsWith("**") && bPart.endsWith("**")) {
        return (
          <strong key={`${i}-${j}`} className="text-cyan-100 font-semibold">
            {bPart.slice(2, -2)}
          </strong>
        );
      }
      return bPart;
    });
  });
}

function MarkdownRenderer({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1 text-xs leading-relaxed break-words" dir="auto">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-1" />;
        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={idx} className="text-xs font-bold text-cyan-300 mt-2 mb-0.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              <span>{renderInlineMarkdown(trimmed.replace("### ", ""))}</span>
            </h4>
          );
        }
        if (trimmed.startsWith("## ") || trimmed.startsWith("# ")) {
          return (
            <h3 key={idx} className="text-xs font-bold text-cyan-200 mt-2 mb-0.5 flex items-center gap-1.5 border-b border-cyan-500/20 pb-0.5">
              <span className="text-cyan-400">◈</span>
              <span>{renderInlineMarkdown(trimmed.replace(/^#+\s*/, ""))}</span>
            </h3>
          );
        }
        if (/^[-*]\s+/.test(trimmed)) {
          return (
            <div key={idx} className="flex items-start gap-1.5 text-slate-200 text-xs">
              <span className="text-cyan-400 text-[10px] mt-0.5 shrink-0">◆</span>
              <span className="flex-1">{renderInlineMarkdown(trimmed.replace(/^[-*]\s+/, ""))}</span>
            </div>
          );
        }
        return (
          <p key={idx} className="text-xs leading-relaxed text-slate-200">
            {renderInlineMarkdown(line)}
          </p>
        );
      })}
    </div>
  );
}

function SidebarMessageBubble({ msg }: { msg: ChatEntry }) {
  const isUser = msg.role === "user";
  const isError = msg.role === "error";
  const [isPlaying, setIsPlaying] = useState(false);
  const [copied, setCopied] = useState(false);

  const { thoughtText, blocks } = useMemo(() => parseMessageBlocks(msg.text), [msg.text]);
  const formattedTime = useMemo(() => {
    const d = new Date(msg.ts || Date.now());
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [msg.ts]);

  const handleSpeak = () => {
    if (isPlaying) {
      stopSpeaking();
      setIsPlaying(false);
    } else {
      speak(msg.text);
      setIsPlaying(true);
      setTimeout(() => setIsPlaying(false), 8000);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (msg.role === "info") {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 my-1 rounded-full bg-cyan-950/40 border border-cyan-500/20 text-cyan-300 text-[10px] font-mono max-w-fit shadow-sm">
        <span className="text-cyan-400">ℹ</span>
        <span>{msg.text}</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col w-full ${isUser ? "items-end" : "items-start"} my-1.5 animate-fadeIn`}>
      <div
        className={`relative max-w-[94%] rounded-xl transition-all duration-300 ${
          isUser
            ? "bg-cyan-950/50 border border-cyan-400/40 text-slate-100 rounded-br-none shadow-[0_2px_15px_rgba(34,211,238,0.12)]"
            : isError
            ? "bg-rose-950/60 border border-rose-500/50 text-rose-200 rounded-bl-none"
            : "bg-slate-900/80 border border-cyan-500/30 text-slate-200 rounded-bl-none shadow-[0_4px_20px_rgba(0,0,0,0.5)]"
        }`}
        style={{ backdropFilter: "blur(12px)" }}
      >
        {/* Header inside Bubble */}
        <div className="flex items-center justify-between px-3 pt-1.5 pb-1 text-[9.5px] border-b border-cyan-500/15 gap-2 font-mono">
          <div className="flex items-center gap-1.5 font-semibold">
            {isUser ? (
              <span className="text-cyan-300 flex items-center gap-1">
                <span>👤</span>
                <span>YOU</span>
              </span>
            ) : (
              <span className="text-cyan-300 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                <span className="uppercase tracking-widest">J.A.R.V.I.S</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <span>{formattedTime}</span>
            {!isUser && (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleSpeak}
                  className="hover:text-cyan-300 transition cursor-pointer text-[10px]"
                  title={isPlaying ? "إيقاف الصوت" : "استماع للرد"}
                >
                  {isPlaying ? "❚❚" : "🔊"}
                </button>
                <button
                  onClick={handleCopy}
                  className="hover:text-cyan-300 transition cursor-pointer text-[10px]"
                  title="نسخ الرد"
                >
                  {copied ? "✓" : "📋"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Thought Telemetry Block (if present) */}
        {thoughtText && (
          <details className="px-3 pt-1.5 text-[10px] text-purple-300/80 font-mono">
            <summary className="cursor-pointer hover:text-purple-200 select-none">
              🧠 تحليل داخلي ({thoughtText.length} حرف)
            </summary>
            <div className="p-2 my-1 rounded bg-purple-950/40 border border-purple-500/20 text-purple-200 whitespace-pre-wrap max-h-32 overflow-y-auto">
              {thoughtText}
            </div>
          </details>
        )}

        {/* Content Body */}
        <div className="p-3">
          {blocks.map((block, idx) => {
            if (block.type === "code") {
              return (
                <div key={idx} className="my-1.5 rounded bg-black/60 border border-cyan-500/20 overflow-hidden font-mono text-[10.5px]">
                  <div className="px-2.5 py-1 bg-slate-900/90 text-cyan-400 text-[9px] uppercase font-bold border-b border-cyan-500/20">
                    {block.lang || "CODE"}
                  </div>
                  <pre className="p-2.5 overflow-x-auto text-slate-200 leading-relaxed">
                    <code>{block.code}</code>
                  </pre>
                </div>
              );
            }
            return <MarkdownRenderer key={idx} text={block.text} />;
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main ChatSidebar Component ────────────────────────────────────────────────

interface ChatSidebarProps {
  input: string;
  setInput: (v: string) => void;
  sending: boolean;
  onSend: () => void;
  micEnabled: boolean;
  liveVoice: boolean;
  toggleMic: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function ChatSidebar({
  input,
  setInput,
  sending,
  onSend,
  micEnabled,
  liveVoice,
  toggleMic,
  collapsed,
  onToggleCollapse,
}: ChatSidebarProps) {
  const chat = useStore((s) => s.chat);
  const clearChat = useStore((s) => s.clearChat);
  const orbState = useStore((s) => s.orbState);
  const connected = useStore((s) => s.connected);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat.length, orbState]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <aside
      className={`h-full flex flex-col z-dialogue transition-all duration-300 relative select-none font-sans ${
        collapsed
          ? "w-12 bg-slate-950/90 border-r border-cyan-500/20 items-center"
          : "w-[360px] lg:w-[400px] bg-slate-950/85 backdrop-blur-2xl border-r border-cyan-500/20 shadow-2xl"
      }`}
      style={{ touchAction: "none" }}
    >
      {/* ── 1. SIDEBAR HEADER ──────────────────────────────────────────────── */}
      <div className="h-12 border-b border-cyan-500/20 px-3.5 flex items-center justify-between bg-slate-950/60 backdrop-blur-md shrink-0 w-full">
        {collapsed ? (
          <button
            onClick={onToggleCollapse}
            className="w-8 h-8 rounded-full border border-cyan-500/30 text-cyan-300 flex items-center justify-center hover:bg-cyan-500/20 transition cursor-pointer"
            title="توسيع قائمة المحادثة"
          >
            ▶
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]" />
              <span className="text-xs font-mono font-bold tracking-wider text-cyan-300 uppercase">
                COMMUNICATIONS LINK
              </span>
              <span className="text-[9.5px] font-mono text-slate-500">
                ({chat.length})
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {chat.length > 0 && (
                <button
                  onClick={clearChat}
                  className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-400 hover:text-rose-300 hover:bg-rose-950/40 border border-slate-800 transition cursor-pointer"
                  title="مسح سجل المحادثة"
                >
                  مسح
                </button>
              )}
              <button
                onClick={onToggleCollapse}
                className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-cyan-300 transition cursor-pointer text-xs"
                title="طي السايدبار"
              >
                ◀
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── 2. SCROLLABLE MESSAGE STREAM ──────────────────────────────────── */}
      {!collapsed && (
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto p-3.5 flex flex-col gap-1 pr-2"
          style={{ scrollbarWidth: "thin" }}
        >
          {chat.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500 my-auto select-none">
              <div className="w-12 h-12 rounded-full border border-cyan-500/20 flex items-center justify-center mb-3 bg-cyan-950/20 shadow-[0_0_20px_rgba(34,211,238,0.1)]">
                <span className="text-xl text-cyan-400 animate-pulse">◈</span>
              </div>
              <span className="text-xs font-mono uppercase tracking-widest text-cyan-300/80">
                STANDBY · نظام الاتصال جاهز
              </span>
              <span className="text-[11px] text-slate-400 mt-1.5 max-w-[240px] leading-relaxed">
                تحدث بحرية أو اكتب أي استفسار لبدء معالجة الأوامر الهولوغرافية.
              </span>
            </div>
          ) : (
            chat.map((m) => <SidebarMessageBubble key={m.id} msg={m} />)
          )}
        </div>
      )}

      {/* ── 3. INTEGRATED COMMAND CAPSULE FOOTER ──────────────────────────── */}
      {!collapsed ? (
        <div className="p-3 border-t border-cyan-500/20 bg-slate-950/90 backdrop-blur-md shrink-0">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-full border border-cyan-500/25 transition-all duration-300 focus-within:border-cyan-400/70 focus-within:shadow-[0_0_15px_rgba(34,211,238,0.25)] bg-slate-900/60"
          >
            {/* Mic Button */}
            <button
              onClick={toggleMic}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs transition cursor-pointer shrink-0 ${
                liveVoice
                  ? "bg-emerald-500/30 text-emerald-200 border border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.7)] animate-pulse"
                  : micEnabled
                  ? "bg-cyan-500/30 text-cyan-200 border border-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)] animate-pulse"
                  : "text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/10"
              }`}
              title={liveVoice ? "المحادثة الحية نشطة" : micEnabled ? "المايك يعمل" : "تشغيل المايك"}
            >
              {liveVoice ? "🟢" : "🎙️"}
            </button>

            {/* Input */}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              dir="auto"
              placeholder={
                liveVoice
                  ? "المحادثة الحية نشطة..."
                  : orbState === "listening"
                  ? "أنا أسمعك الآن..."
                  : orbState === "thinking"
                  ? "جارٍ المعالجة..."
                  : "اسأل جارفيس..."
              }
              className="flex-1 bg-transparent text-xs text-slate-100 placeholder-slate-500 outline-none font-sans"
              style={{ caretColor: "#22d3ee" }}
            />

            {/* Send Button */}
            <button
              onClick={onSend}
              disabled={!input.trim() || sending}
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs transition cursor-pointer shrink-0 ${
                input.trim() && !sending
                  ? "bg-cyan-500/30 text-cyan-200 hover:bg-cyan-500/50 border border-cyan-400/60"
                  : "text-slate-600 cursor-not-allowed"
              }`}
              title="إرسال"
            >
              ⟶
            </button>
          </div>
        </div>
      ) : (
        /* Collapsed minimal bottom mic trigger */
        <div className="p-2 border-t border-cyan-500/20 w-full flex items-center justify-center">
          <button
            onClick={toggleMic}
            className="w-8 h-8 rounded-full border border-cyan-500/30 text-cyan-300 flex items-center justify-center hover:bg-cyan-500/20"
            title="تفعيل المايك"
          >
            🎙️
          </button>
        </div>
      )}
    </aside>
  );
}
