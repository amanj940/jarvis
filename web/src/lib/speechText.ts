/**
 * Pure helpers for deciding what assistant text is safe to speak / display.
 * No store or DOM imports — unit-testable under `node --test`.
 */

// ── JSON payload & error-dump filtering ──────────────────────────────────────
//
// Models sometimes answer with a raw JSON object/array instead of prose, or
// leak error payloads (tracebacks, {"error": ...} blobs). These helpers detect
// balanced JSON regions — closed AND still-streaming unclosed — and either
// extract the human-readable field ("answer"/"response"/"message"/…) or drop
// the blob entirely. Regions inside ``` fences are left untouched.

const JSON_DISPLAY_KEYS = [
  "answer", "response", "reply", "text", "message", "content", "result",
  "output", "summary", "description", "error", "detail", "reason", "msg",
];

// Matches `"key": "value` where key is a known display field. The value group
// tolerates an unterminated trailing string (still streaming).
const JSON_DISPLAY_KEY_RE = new RegExp(
  `"(?:${JSON_DISPLAY_KEYS.join("|")})"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)(?:"|$)`,
  "gi",
);

// JSON-ish heuristic: "key": pattern anywhere, or a region starting with `[`.
const JSONISH_RE = /"(?:[^"\\]|\\.)*"\s*:/;

function isJsonStart(text: string, i: number): boolean {
  let j = i + 1;
  while (j < text.length && /\s/.test(text[j])) j++;
  if (j >= text.length) return false;
  const c = text[j];
  return (
    c === '"' || c === "{" || c === "[" || c === "]" || c === "}" ||
    c === "-" || c === "+" || /[0-9]/.test(c)
  );
}

// Scan a balanced {...} / [...] region starting at `start`. String-aware so
// braces inside quoted values don't count. Returns end index + closed flag.
function scanJsonRegion(text: string, start: number): { end: number; closed: boolean } {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < text.length; k++) {
    const c = text[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return { end: k + 1, closed: true };
    }
  }
  return { end: text.length, closed: false };
}

function unescapeJsonString(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") { out += c; continue; }
    const n = s[++i];
    if (n === undefined) break;
    switch (n) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "u": {
        const hex = s.substr(i + 1, 4);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          out += "u";
        }
        break;
      }
      default: out += n;
    }
  }
  return out;
}

// Pull a display string out of a parsed JSON value. Objects prefer known
// display keys, then recurse into nested objects/arrays. Bare strings inside
// objects are NOT picked up (avoids leaking tool-call "name"/"arguments").
function jsonValueToText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v.map(jsonValueToText).filter((s) => s.trim()).join("\n");
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of JSON_DISPLAY_KEYS) {
      if (k in o) {
        const t = jsonValueToText(o[k]);
        if (t.trim()) return t;
      }
    }
    for (const val of Object.values(o)) {
      if (val && typeof val === "object") {
        const t = jsonValueToText(val);
        if (t.trim()) return t;
      }
    }
  }
  return "";
}

// Best-effort extraction from a JSON region that failed JSON.parse — either
// unclosed (still streaming) or malformed. Returns "" when nothing usable.
function partialJsonToText(region: string): string {
  JSON_DISPLAY_KEY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JSON_DISPLAY_KEY_RE.exec(region)) !== null) {
    const v = unescapeJsonString(m[1]);
    if (v.trim()) return v;
  }
  if (region.trimStart().startsWith("[")) {
    const strRe = /"((?:[^"\\]|\\.)*)(?:"|$)/g;
    const parts: string[] = [];
    let s: RegExpExecArray | null;
    while ((s = strRe.exec(region)) !== null) {
      const v = unescapeJsonString(s[1]);
      if (v.trim()) parts.push(v);
    }
    return parts.join("\n");
  }
  return "";
}

// Returns the replacement text for a JSON region, or null to keep it verbatim
// (i.e. it only looked brace-ish but isn't JSON at all).
function regionToDisplayText(region: string, closed: boolean): string | null {
  if (closed) {
    try {
      return jsonValueToText(JSON.parse(region));
    } catch { /* fall through to heuristics */ }
  }
  if (JSONISH_RE.test(region) || /^\s*\[/.test(region)) {
    return partialJsonToText(region);
  }
  return null;
}

/**
 * Replace raw JSON objects/arrays in model output with their human-readable
 * payload (e.g. {"answer": "…"} → the answer), or drop pure-JSON noise.
 * Fenced code blocks are preserved verbatim. Works mid-stream: an unclosed
 * trailing {...} / [...] region is handled via partial extraction.
 */
export function sanitizeModelJson(text: string): string {
  if (!text || (!text.includes("{") && !text.includes("["))) return text;
  let out = "";
  let i = 0;
  let inFence = false;
  const n = text.length;
  while (i < n) {
    if (text.startsWith("```", i)) {
      if (inFence) {
        const close = text.indexOf("```", i + 3);
        const end = close === -1 ? n : close + 3;
        out += text.slice(i, end);
        i = end;
        inFence = false;
      } else {
        inFence = true;
        out += "```";
        i += 3;
      }
      continue;
    }
    if (inFence) {
      out += text[i++];
      continue;
    }
    const c = text[i];
    if ((c === "{" || c === "[") && isJsonStart(text, i)) {
      const { end, closed } = scanJsonRegion(text, i);
      const region = text.slice(i, end);
      const replacement = regionToDisplayText(region, closed);
      if (replacement === null) {
        out += region;
      } else {
        const rep = replacement.trim();
        out += rep ? ` ${rep} ` : " ";
      }
      i = end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Collapse a Python traceback dump to its final exception line so error
 * bubbles show `ValueError: …` instead of a wall of stack frames.
 * Non-traceback text is returned unchanged.
 */
export function reduceErrorDump(text: string): string {
  const t = (text || "").trim();
  if (!/^traceback \(most recent call last\)/i.test(t)) return text;
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] || text;
}

/**
 * Sanitize text shown inside error/diagnostic UI: strips the [brain error]
 * prefix, reduces tracebacks, and extracts/drops JSON payloads.
 */
export function sanitizeErrorText(raw: string): string {
  const t = (raw || "").replace(/^\[brain error\]\s*/i, "").trim();
  if (!t) return "";
  return sanitizeModelJson(reduceErrorDump(t)).trim();
}

/**
 * Display-ready assistant text: markup stripped (thinking / tool calls /
 * special tokens), JSON payloads extracted or dropped, fenced code kept.
 */
export function cleanDisplayText(raw: string): string {
  return stripMarkup(raw, true);
}

function stripMarkup(text: string, keepFences: boolean): string {
  let t = text;

  // Closed + unclosed thinking blocks (also bare <thinking> tags).
  t = t.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?(<\/think(?:ing)?\s*>|$)/gi, " ");
  t = t.replace(/<\/?think(?:ing)?\b[^>]*>/gi, " ");

  // Closed + unclosed tool-call blocks (<tool_call>, <toolcall>, <tool_call …>).
  t = t.replace(/<tool_?calls?\b[^>]*>[\s\S]*?(<\/tool_?calls?\s*>|$)/gi, " ");
  t = t.replace(/<\/?tool_?calls?\b[^>]*>/gi, " ");

  // Tool result blocks (<tool_result>…</tool_result>, closed or unclosed).
  t = t.replace(/<tool_?results?\b[^>]*>[\s\S]*?(<\/tool_?results?\s*>|$)/gi, " ");
  t = t.replace(/<\/?tool_?results?\b[^>]*>/gi, " ");

  // Special/control tokens: <|im_end|>,  etc.
  t = t.replace(/<\|[^|]*\|>/g, " ");

  // Bare JSON payloads — extract human-readable fields or drop the blob.
  // Runs before fence removal so JSON inside ``` blocks stays untouched.
  t = sanitizeModelJson(t);

  if (!keepFences) {
    // Fenced code blocks — closed pairs, then an unclosed trailing fence.
    t = t.replace(/```[\s\S]*?```/g, " ");
    t = t.replace(/```[\s\S]*$/, " ");

    // Bare JSON tool-call blobs. Closed flat objects first, then an unclosed
    // trailing one (still streaming). Kept conservative: must mention a
    // tool-ish key so normal prose with braces survives.
    t = t.replace(/\{[^{}]*"(?:name|tool|tool_name|function|arguments|parameters|args|input)"[^{}]*\}/g, " ");
    t = t.replace(/\{[^{}]*"(?:name|tool|tool_name|function|arguments|parameters|args|input)"[\s\S]*$/, " ");
  }

  // Trailing partial tag that may still grow into one of the blocks above
  // (e.g. stream ends mid-"<tool_ca"). Only strips at end-of-string, and only
  // when the partial is a prefix of a known tag name.
  const TAG_NAMES = ["thinking", "think", "tool_call", "toolcall", "tool_calls", "toolcalls", "tool_result", "toolresult"];
  t = t.replace(/<\/?[a-z_]*$/i, (m) => {
    const name = m.replace(/^<\/?/, "").toLowerCase();
    return name && TAG_NAMES.some((tag) => tag.startsWith(name)) ? " " : m;
  });

  return t;
}

/**
 * Remove content that must never be spoken aloud:
 *   - <thinking>…</thinking> / <think>…</think> blocks (closed AND unclosed)
 *   - <tool_call>…</tool_call> / <toolcall>…</toolcall> blocks (closed, unclosed,
 *     and still-streaming partials like a trailing "<tool_ca")
 *   - <tool_result> blocks
 *   - special tokens like <|im_end|>
 *   - fenced code blocks (``` … ``` and an unclosed trailing fence), which is
 *     where mermaid diagrams / JSON payloads would otherwise be read aloud
 *   - bare JSON payloads ({"answer": …} is reduced to its text field, pure
 *     JSON noise is dropped)
 */
export function stripNonSpeech(text: string): string {
  return stripMarkup(text, false);
}

/**
 * True when an assistant chat entry has no user-visible content left after
 * stripping non-speech markup — i.e. it was only tool calls / thinking /
 * pure JSON noise. Fenced code counts as content (it renders as a code card).
 */
export function isEmptyAssistantText(rawText: string): boolean {
  return stripMarkup(rawText, true).replace(/[\s\*_`#>~\-[\]()\\|/{}"':;]/g, "").length === 0;
}
