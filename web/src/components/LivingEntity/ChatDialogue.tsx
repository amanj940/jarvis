/**
 * J.A.R.V.I.S — HOLOGRAPHIC CHAT DIALOGUE & MESSAGE BUBBLES
 *
 * Cinematic Sci-Fi HUD Message System:
 *   - Assistant Bubbles: Frosted obsidian glass, cyan/gold hairline borders,
 *     animated streaming cursor, audio re-read button, and tool telemetry.
 *   - User Bubbles: Sleek cyan-tinted glass capsules with user identity badge.
 *   - Neural Cognition (<thinking>): Collapsible purple-accented telemetry block.
 *   - Interactive Code Blocks: High-tech terminal frame with syntax styling & copy.
 *   - Rich Markdown Parser: Headings, bold, italic, bullet lists, inline code.
 *   - Expandable History Drawer: Seamless toggle between compact HUD & full history.
 */
import React, { useState, useRef, useEffect, useMemo } from "react";
import { useStore, type ChatEntry } from "../../lib/store";
import { speak, stopSpeaking } from "../../lib/voice";

// ── Markdown Formatter Helper ────────────────────────────────────────────────

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
  toolCalls: string[];
  blocks: ParsedBlock[];
  cleanText: string;
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

  // 2. Extract tool calls
  const toolCalls: string[] = [];
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let tcMatch;
  while ((tcMatch = toolCallRegex.exec(raw)) !== null) {
    try {
      const parsed = JSON.parse(tcMatch[1]);
      if (parsed.name) toolCalls.push(parsed.name);
    } catch {
      const nameM = tcMatch[1].match(/"name":\s*"([^"]+)"/);
      if (nameM) toolCalls.push(nameM[1]);
    }
  }
  raw = raw.replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/gi, "").trim();
  raw = raw.replace(/<\/?tool_call>/gi, "").trim();

  // 3. Extract code blocks vs regular text
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  const blocks: ParsedBlock[] = [];
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: "text", text: raw.substring(lastIndex, match.index) });
    }
    blocks.push({ type: "code", lang: match[1] || "code", code: match[2].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < raw.length) {
    blocks.push({ type: "text", text: raw.substring(lastIndex) });
  }

  return { thoughtText, toolCalls, blocks, cleanText: raw };
}

/**
 * Format markdown text (headings, bold, italic, bullet lists, inline code).
 */
function renderFormattedText(text: string) {
  const lines = text.split("\n");

  return (
    <div className="space-y-1">
      {lines.map((line, lineIdx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={lineIdx} className="h-1.5" />;

        // Headings ###
        if (trimmed.startsWith("### ")) {
          return (
            <h4 key={lineIdx} className="text-xs font-bold text-cyan-300 mt-2 mb-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              <span>{renderInlineMarkdown(trimmed.replace("### ", ""))}</span>
            </h4>
          );
        }
        if (trimmed.startsWith("## ") || trimmed.startsWith("# ")) {
          return (
            <h3 key={lineIdx} className="text-sm font-bold text-cyan-200 mt-2.5 mb-1 flex items-center gap-1.5 border-b border-cyan-500/20 pb-0.5">
              <span className="text-cyan-400">◈</span>
              <span>{renderInlineMarkdown(trimmed.replace(/^#+\s*/, ""))}</span>
            </h3>
          );
        }

        // Bullet points (- or *)
        if (/^[-*]\s+/.test(trimmed)) {
          const itemText = trimmed.replace(/^[-*]\s+/, "");
          return (
            <div key={lineIdx} className="flex items-start gap-2 pr-1 text-slate-200 text-xs leading-relaxed">
              <span className="text-cyan-400 text-[10px] mt-0.5 shrink-0">◆</span>
              <span className="flex-1">{renderInlineMarkdown(itemText)}</span>
            </div>
          );
        }

        // Numbered list (1. 2.)
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
        if (numMatch) {
          return (
            <div key={lineIdx} className="flex items-start gap-2 pr-1 text-slate-200 text-xs leading-relaxed">
              <span className="text-[10px] font-mono text-cyan-300 font-bold px-1 rounded bg-cyan-950/60 border border-cyan-500/30 shrink-0">
                {numMatch[1]}
              </span>
              <span className="flex-1">{renderInlineMarkdown(numMatch[2])}</span>
            </div>
          );
        }

        // Regular paragraph
        return (
          <p key={lineIdx} className="text-xs leading-relaxed text-slate-200">
            {renderInlineMarkdown(line)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Handle inline markdown: **bold**, *italic*, `code`
 */
function renderInlineMarkdown(str: string): React.ReactNode {
  // Split on inline code `...`
  const codeParts = str.split(/(`[^`]+`)/g);

  return codeParts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="mx-0.5 px-1.5 py-0.5 rounded bg-cyan-950/70 border border-cyan-500/30 text-cyan-300 font-mono text-[11px]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // Bold / italic inside normal text
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

// ── Code Terminal Card ────────────────────────────────────────────────────────

function CodeTerminalCard({
  code,
  lang,
  blockId,
}: {
  code: string;
  lang: string;
  blockId: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const lineCount = code.split("\n").length;

  return (
    <div className="my-2.5 rounded-xl border border-cyan-500/30 bg-slate-950/90 shadow-lg overflow-hidden font-mono text-xs">
      {/* Terminal Title Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-cyan-500/20 text-[10px]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-rose-500/80" />
            <span className="w-2 h-2 rounded-full bg-amber-500/80" />
            <span className="w-2 h-2 rounded-full bg-emerald-500/80" />
          </div>
          <span className="text-cyan-400 font-bold uppercase tracking-wider">{lang || "CODE"}</span>
          <span className="text-slate-500">· {lineCount} {lineCount === 1 ? "line" : "lines"}</span>
        </div>
        <button
          onClick={handleCopy}
          className="px-2 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-400/30 transition cursor-pointer flex items-center gap-1 text-[10px]"
          title="نسخ الشفرة البرمجية"
        >
          <span>{copied ? "✓" : "📋"}</span>
          <span>{copied ? "تم النسخ" : "نسخ"}</span>
        </button>
      </div>

      {/* Code Body */}
      <pre className="p-3 overflow-x-auto text-slate-200 text-[11px] leading-relaxed select-text font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ── Single Message Bubble ─────────────────────────────────────────────────────

function SingleMessageBubble({
  msg,
  isLatest,
  onDismiss,
}: {
  msg: ChatEntry;
  isLatest: boolean;
  onDismiss?: () => void;
}) {
  if (msg.role === "info") {
    return (
      <div className="flex items-center gap-2 px-3 py-1 my-1 rounded-full bg-cyan-950/40 border border-cyan-500/20 text-cyan-300/80 text-[10.5px] font-mono max-w-fit shadow-sm animate-fadeIn">
        <span className="text-cyan-400 text-xs">ℹ</span>
        <span>{msg.text}</span>
      </div>
    );
  }

  const isUser = msg.role === "user";
  const isBrainError = msg.text.startsWith("[brain error]");
  const isError = msg.role === "error" || isBrainError;
  const isArabic = useMemo(() => /[\u0600-\u06FF]/.test(msg.text), [msg.text]);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const { thoughtText, toolCalls, blocks, cleanText } = useMemo(
    () => parseMessageBlocks(msg.text),
    [msg.text]
  );

  const formattedTime = useMemo(() => {
    const d = new Date(msg.ts || Date.now());
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [msg.ts]);

  const handleToggleSpeak = () => {
    if (isPlayingAudio) {
      stopSpeaking();
      setIsPlayingAudio(false);
    } else {
      speak(msg.text);
      setIsPlayingAudio(true);
      setTimeout(() => setIsPlayingAudio(false), 8000);
    }
  };

  const handleCopyFull = () => {
    navigator.clipboard.writeText(msg.text).then(() => {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    });
  };

  return (
    <div className={`flex flex-col w-full ${isUser ? "items-end" : "items-start"} animate-fadeIn`}>
      <div
        className={`relative pointer-events-auto max-w-[95%] md:max-w-[88%] rounded-2xl transition-all duration-300 ${
          isUser
            ? "bg-gradient-to-l from-cyan-950/60 via-slate-900/80 to-slate-950/70 border border-cyan-400/40 text-slate-100 shadow-[0_2px_15px_rgba(34,211,238,0.15)] rounded-br-none"
            : isError
            ? "bg-rose-950/70 border border-rose-500/50 text-rose-200 shadow-[0_2px_15px_rgba(244,63,94,0.18)] rounded-bl-none"
            : "bg-slate-950/85 border border-cyan-500/30 text-slate-200 shadow-[0_4px_25px_rgba(6,182,212,0.12)] rounded-bl-none"
        }`}
        style={{ backdropFilter: "blur(16px)" }}
      >
        {/* Header Bar inside Bubble */}
        <div className="flex items-center justify-between px-3.5 pt-2 pb-1 text-[10px] border-b border-cyan-500/15 gap-3">
          <div className="flex items-center gap-1.5 font-mono font-semibold">
            {isUser ? (
              <span className="text-cyan-300 flex items-center gap-1">
                <span>👤</span>
                <span>أنت · YOU</span>
              </span>
            ) : isError ? (
              <span className="text-rose-300 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                <span className="tracking-wide">تنبيه النظام · SYSTEM ALERT</span>
              </span>
            ) : (
              <span className="text-cyan-300 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                <span className="tracking-widest uppercase">J.A.R.V.I.S</span>
                {msg.streaming && (
                  <span className="text-[9px] text-cyan-400/80 font-normal animate-pulse">
                    جارٍ الإرسال...
                  </span>
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-slate-400 text-[10px] font-mono">
            <span>{formattedTime}</span>

            {/* Assistant Voice & Copy Action Icons */}
            {!isUser && (
              <div className="flex items-center gap-1.5">
                {!isError && (
                  <button
                    onClick={handleToggleSpeak}
                    className={`p-1 rounded hover:bg-cyan-500/20 transition cursor-pointer ${
                      isPlayingAudio ? "text-cyan-300 animate-pulse" : "text-slate-400 hover:text-cyan-200"
                    }`}
                    title={isPlayingAudio ? "إيقاف النطق" : "إعادة نطق الرد"}
                  >
                    {isPlayingAudio ? "❚❚" : "🔊"}
                  </button>
                )}
                <button
                  onClick={handleCopyFull}
                  className="p-1 rounded hover:bg-cyan-500/20 text-slate-400 hover:text-cyan-200 transition cursor-pointer"
                  title="نسخ نص الإجابة كاملاً"
                >
                  {copiedAll ? "✓" : "📋"}
                </button>
                {isLatest && onDismiss && (
                  <button
                    onClick={onDismiss}
                    className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-white transition cursor-pointer text-xs"
                    title="إخفاء الفقاعة"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Content Body */}
        <div className="p-3.5 text-xs leading-relaxed space-y-2">
          {/* Elegant Diagnostic Display for Network/Brain Error */}
          {isBrainError ? (
            <div className="space-y-1.5 font-sans" dir="rtl">
              <div className="flex items-center gap-2 text-rose-300 font-bold text-xs">
                <span>⚡</span>
                <span>النموذج غير متاح · Neural Link Offline</span>
              </div>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                تعذّر الوصول للمزود السحابي. تحقق من اتصال الشبكة وأعد الإرسال.
              </p>
              <div className="text-[9px] text-slate-500 font-mono bg-slate-900/80 px-2 py-1 rounded border border-rose-500/15 truncate text-left" dir="ltr" title={msg.text}>
                {msg.text.replace("[brain error]", "").trim().slice(0, 80)}
              </div>
            </div>
          ) : (
            <>
              {/* Tool Calls Chips */}
              {toolCalls.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {toolCalls.map((name, i) => (
                    <div
                      key={i}
                      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-cyan-400/40 bg-cyan-950/60 text-[10px] font-mono text-cyan-200 shadow-sm"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                      <span>⚡ استدعاء أداة:</span>
                      <span className="text-cyan-100 font-semibold">{name}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Neural Cognition (<thinking>) Block */}
              {thoughtText && (
                <details className="group rounded-xl border border-purple-500/30 bg-purple-950/30 text-[11px] font-mono overflow-hidden transition-all my-1.5 pointer-events-auto">
                  <summary className="px-3 py-1.5 cursor-pointer hover:bg-purple-900/30 text-purple-300 font-semibold flex items-center justify-between select-none">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs">🧠</span>
                      <span>المسار الإدراكي العصبي · NEURAL COGNITION</span>
                    </div>
                    <span className="text-[10px] text-purple-400/60 group-open:rotate-180 transition-transform">
                      ▼
                    </span>
                  </summary>
                  <div className="p-3 border-t border-purple-500/20 bg-purple-950/40 text-purple-200/90 leading-relaxed whitespace-pre-wrap text-[11px]">
                    {thoughtText}
                  </div>
                </details>
              )}

              {/* Main Formatted Text & Code with Auto RTL */}
              <div
                dir={isArabic ? "rtl" : "ltr"}
                className={isArabic ? "text-right font-sans text-[12.5px] leading-relaxed" : "text-left font-mono text-xs"}
              >
                {blocks.length === 0 ? (
                  cleanText ? (
                    <div className="whitespace-pre-wrap text-slate-200">{renderFormattedText(cleanText)}</div>
                  ) : toolCalls.length > 0 ? (
                    <div className="flex items-center gap-2 text-cyan-300 text-xs py-1 font-mono">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                      <span>جارٍ معالجة وتنفيذ الأداة في النظام...</span>
                    </div>
                  ) : null
                ) : (
                  blocks.map((block, idx) => {
                    if (block.type === "code") {
                      return (
                        <CodeTerminalCard
                          key={idx}
                          code={block.code}
                          lang={block.lang}
                          blockId={`${msg.id}-${idx}`}
                        />
                      );
                    }
                    return (
                      <div key={idx}>
                        {renderFormattedText(block.text)}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Streaming blinking beam cursor */}
              {msg.streaming && isLatest && (
                <span className="inline-block w-2 h-3.5 ml-1 bg-cyan-400 animate-pulse align-middle shadow-[0_0_8px_#22d3ee]" />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Chat Dialogue Container (Standalone Floating Bubbles — NO Outer Box) ──

export default function ChatDialogue({
  dialogueVisible,
  onDismiss,
}: {
  dialogueVisible: boolean;
  onDismiss: () => void;
}) {
  const chat = useStore((s) => s.chat);
  const orbState = useStore((s) => s.orbState);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Show only the latest 3 active floating bubbles without any enclosing box
  const displayedMessages = useMemo(() => {
    return chat.slice(-3);
  }, [chat]);

  // Auto-scroll on new message or stream chunk
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [displayedMessages, orbState]);

  if (!dialogueVisible || chat.length === 0) return null;

  return (
    <div
      className="absolute bottom-3 left-4 md:left-6 z-dialogue pointer-events-none transition-all duration-500 ease-out max-w-[380px] lg:max-w-[440px] w-[calc(100%-2rem)]"
      style={{ opacity: dialogueVisible ? 1 : 0 }}
    >
      {/* Standalone Floating Bubbles Stream — Docked to the Left Side */}
      <div
        ref={chatScrollRef}
        className="w-full flex flex-col gap-2.5 overflow-y-auto max-h-[40vh] min-h-0 pointer-events-none pb-1"
        style={{ scrollbarWidth: "none" }}
      >
        {displayedMessages.map((m, idx) => (
          <SingleMessageBubble
            key={m.id}
            msg={m}
            isLatest={idx === displayedMessages.length - 1}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>
  );
}


