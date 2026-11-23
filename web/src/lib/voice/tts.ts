/**
 * Browser-side TTS: server TTS (/api/tts, Piper/Riva/Edge) with a
 * sentence-streaming queue, plus browser SpeechSynthesis fallback.
 * (Phase 2 split of lib/voice.ts.)
 */
import { useStore, type VoiceProfile } from "../store";
import { API_BASE } from "../api";
import { mic } from "./mic";

// --- TTS ---
const SYNTH = typeof window !== "undefined" ? window.speechSynthesis : null;

const JARVIS_VOICE_MATCHERS = [
  /microsoft ryan.*(?:online|natural)|ryan.*(?:online|natural)/i,
  /en-GB-Ryan/i,
  /microsoft george/i,
  /google uk english male/i,
  /\bDaniel\b/i,
  /\bOliver\b/i,
  /\bGeorge\b/i,
  /\bArthur\b/i,
  /\bRyan\b/i,
];

const LOWER_CONFIDENCE_VOICES = /female|hazel|susan|sonia|libby|zira|aria|jenny/i;

let cachedVoice: SpeechSynthesisVoice | null = null;
let activeAudio: HTMLAudioElement | null = null;
let activeAudioUrl: string | null = null;

// ── Streaming TTS queue ────────────────────────────────────────────────────
// Sentences are detected as they stream in. Each sentence is fetched
// independently from /api/tts and queued. Audio plays in order so the
// listener hears JARVIS in real time, not after the full text finishes.
//
// HARD GUARANTEE — only ONE audio source plays at a time:
//   • single shared HTMLAudioElement `playerAudio` (browser cannot play two
//     clips on one element). All streaming clips run through it serially.
//   • every queue mutation and every clip start gates on `streamGeneration`.
//     A cancel bumps the generation; any in-flight fetch / scheduled
//     advance from the previous generation drops on sight.
//   • cancel pauses the player FIRST, then clears the queue, then nukes any
//     legacy speakWithServerTts audio AND browser-SpeechSynthesis voice.
type QueuedClip = { url: string };
const ttsQueue: QueuedClip[] = [];
let ttsPlaying = false;
let activeUrl: string | null = null;
const playerAudio: HTMLAudioElement | null =
  typeof Audio !== "undefined" ? new Audio() : null;
let audioWakeupPlayed = false; // Flag to play wakeup audio once

// ── Genuine Assistant Output Audio Amplitude Analyser ────────────────────────
let ttsAudioContext: AudioContext | null = null;
let ttsAnalyser: AnalyserNode | null = null;
let ttsSourceNode: MediaElementAudioSourceNode | null = null;
let ttsAnalyserRaf: number = 0;
const ttsFreqData = new Uint8Array(256);

function ensureTtsAudioAnalysis(): void {
  // STRICT SAFETY: AudioContext.createMediaElementSource throws if called more
  // than once on the same HTMLAudioElement instance. Guard with ttsSourceNode check.
  if (!playerAudio || ttsSourceNode) return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    ttsAudioContext = new AudioCtx();
    ttsAnalyser = ttsAudioContext.createAnalyser();
    ttsAnalyser.fftSize = 512;  // higher resolution for particle frequency mapping
    ttsAnalyser.smoothingTimeConstant = 0.78;
    ttsSourceNode = ttsAudioContext.createMediaElementSource(playerAudio);
    ttsSourceNode.connect(ttsAnalyser);
    ttsAnalyser.connect(ttsAudioContext.destination);
    // Expose analyser globally so LivingEntityCore can read frequency data
    // without direct module coupling. Zero-cost: just a window property assignment.
    (window as any).__jarvisTtsAnalyser = ttsAnalyser;
    console.log("[TTS:analyser] Web Audio output amplitude analyser successfully connected.");
  } catch (e) {
    console.warn("[TTS:analyser] Web Audio setup warning:", e);
  }
}


function startTtsAmplitudeTracking(): void {
  if (ttsAnalyserRaf) cancelAnimationFrame(ttsAnalyserRaf);
  const tick = () => {
    if (!ttsPlaying || !ttsAnalyser) {
      useStore.getState().setSpeakerAudioLevel(0);
      ttsAnalyserRaf = 0;
      return;
    }
    ttsAnalyser.getByteFrequencyData(ttsFreqData);
    let sum = 0;
    for (let i = 0; i < ttsFreqData.length; i++) {
      sum += ttsFreqData[i];
    }
    const lvl = sum / ttsFreqData.length / 255;
    useStore.getState().setSpeakerAudioLevel(lvl);
    ttsAnalyserRaf = requestAnimationFrame(tick);
  };
  ttsAnalyserRaf = requestAnimationFrame(tick);
}

function stopTtsAmplitudeTracking(): void {
  if (ttsAnalyserRaf) {
    cancelAnimationFrame(ttsAnalyserRaf);
    ttsAnalyserRaf = 0;
  }
  useStore.getState().setSpeakerAudioLevel(0);
}

if (typeof window !== "undefined") {
  const resumeOnInteraction = () => {
    if (ttsAudioContext && ttsAudioContext.state === "suspended") {
      ttsAudioContext.resume().catch(() => {});
    }
  };
  window.addEventListener("click", resumeOnInteraction, { passive: true });
  window.addEventListener("keydown", resumeOnInteraction, { passive: true });
}

if (playerAudio) {
  playerAudio.preload = "auto";
  playerAudio.volume = 1.0;
  // Single global listeners — re-attaching per clip caused leak + race.
  playerAudio.addEventListener("ended", () => {
    stopTtsAmplitudeTracking();
    console.log("[TTS:player] audio ended");
    handleClipFinished("ended");
  });
  playerAudio.addEventListener("error", (e) => {
    stopTtsAmplitudeTracking();
    console.error("[TTS:player] audio error:", e);
    handleClipFinished("error");
  });
  playerAudio.addEventListener("pause", () => {
    stopTtsAmplitudeTracking();
  });
  playerAudio.addEventListener("play", () => {
    ensureTtsAudioAnalysis();
    if (ttsAudioContext && ttsAudioContext.state === "suspended") {
      ttsAudioContext.resume().catch(() => {});
    }
    startTtsAmplitudeTracking();
    console.log("[TTS:player] audio started playing");
  });
}

// Wake up audio sinks (PipeWire suspend fix)
async function wakeupAudioSinks(): Promise<void> {
  if (audioWakeupPlayed) return;
  try {
    console.log("[TTS:wakeup] waking up audio sinks...");
    const resp = await fetch(`${API_BASE}/audio/wakeup`);
    if (resp.ok) {
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const wakeupAudio = new Audio(url);
      wakeupAudio.volume = 0.001; // Almost silent
      await wakeupAudio.play();
      await new Promise(r => setTimeout(r, 100)); // Wait a bit
      wakeupAudio.pause();
      URL.revokeObjectURL(url);
      audioWakeupPlayed = true;
      console.log("[TTS:wakeup] audio sinks awakened");
    }
  } catch (e) {
    console.warn("[TTS:wakeup] failed:", e);
  }
}
const streamState = { id: "", spokenChars: 0 };
let pendingFetches = 0;
let streamGeneration = 0;   // bumped on cancel — stale fetches compare this
let activeGeneration = 0;   // the generation that owns the currently-playing clip
function voiceScore(voice: SpeechSynthesisVoice): number {
  const label = `${voice.name} ${voice.lang}`;
  const matcherIndex = JARVIS_VOICE_MATCHERS.findIndex((re) => re.test(label));
  let score = matcherIndex >= 0 ? 120 - matcherIndex * 10 : 0;
  if (/en-GB/i.test(label)) score += 35;
  if (/(?:natural|online|neural)/i.test(label)) score += 25;
  if (LOWER_CONFIDENCE_VOICES.test(label)) score -= 20;
  if (/^en/i.test(voice.lang)) score += 5;
  return score;
}

function voiceTier(voice: SpeechSynthesisVoice | null): VoiceProfile["tier"] {
  if (!voice) return "offline";
  const label = `${voice.name} ${voice.lang}`;
  if (/ryan|george|daniel|oliver|arthur|google uk english male/i.test(label)) return "cinematic";
  if (/en-GB|UK English|British/i.test(label)) return "british";
  return "fallback";
}

function publishVoiceProfile(voice: SpeechSynthesisVoice | null) {
  useStore.getState().setVoiceProfile(
    voice
      ? { name: voice.name, lang: voice.lang, tier: voiceTier(voice) }
      : { name: "No browser TTS voice", lang: "offline", tier: "offline" }
  );
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (!SYNTH) {
    publishVoiceProfile(null);
    return null;
  }
  if (cachedVoice) return cachedVoice;
  const voices = SYNTH.getVoices();
  const ranked = [...voices].sort((a, b) => voiceScore(b) - voiceScore(a));
  const prefer = ranked.find((v) => voiceScore(v) > 0)
              || voices.find((v) => v.lang === "en-GB")
              || voices.find((v) => v.lang.startsWith("en"))
              || voices[0]
              || null;
  cachedVoice = prefer ?? null;
  publishVoiceProfile(cachedVoice);
  return cachedVoice;
}

if (typeof window !== "undefined" && SYNTH) {
  SYNTH.onvoiceschanged = () => { cachedVoice = null; pickVoice(); };
}

export function refreshVoiceProfile(): void {
  void refreshServerVoiceProfile();
  pickVoice();
}

export function currentVoiceProfile(): VoiceProfile | null {
  const voice = pickVoice();
  return voice ? { name: voice.name, lang: voice.lang, tier: voiceTier(voice) } : null;
}

async function refreshServerVoiceProfile(): Promise<void> {
  try {
    const resp = await fetch(`${API_BASE}/api/tts/status`);
    if (!resp.ok) return;
    const status = await resp.json();
    if (status?.available) {
      useStore.getState().setVoiceProfile({
        name: status.label || "Microsoft Ryan Neural",
        lang: status.lang || "en-GB",
        tier: "cinematic",
      });
    }
  } catch {
    // browser voices remain the fallback
  }
}

function cleanSpeechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/[*_`#>~]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .trim();
}

function stopServerAudio() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }
  if (activeAudioUrl) {
    URL.revokeObjectURL(activeAudioUrl);
    activeAudioUrl = null;
  }
}

async function speakWithServerTts(clean: string): Promise<boolean> {
  try {
    console.log("[TTS] requesting server TTS…");
    const resp = await fetch(`${API_BASE}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean }),
    });
    console.log("[TTS] server response:", resp.status, resp.headers.get("content-type"));
    if (!resp.ok) {
      console.warn("[TTS] server returned", resp.status);
      return false;
    }
    const blob = await resp.blob();
    console.log("[TTS] audio blob:", blob.size, "bytes, type:", blob.type);
    if (!blob.size) return false;

    stopServerAudio();
    SYNTH?.cancel();
    activeAudioUrl = URL.createObjectURL(blob);
    activeAudio = new Audio(activeAudioUrl);
    activeAudio.autoplay = true;
    activeAudio.preload = "auto";
    activeAudio.onplay = () => {
      console.log("[TTS] ✓ PLAYING audio! volume:", activeAudio?.volume, "currentTime:", activeAudio?.currentTime);
      const isArabic = /[\u0600-\u06FF]/.test(clean);
      useStore.getState().setVoiceProfile({
        name: isArabic ? "Hamed Neural (Arabic)" : "Thomas Neural (British)",
        lang: isArabic ? "ar-SA" : "en-GB",
        tier: "cinematic",
      });

      useStore.getState().setOrb("speaking");
      mic.onTtsStart();
    };
    activeAudio.onended = () => {
      console.log("[TTS] audio ended");
      stopServerAudio();
      if (useStore.getState().orbState === "speaking") useStore.getState().setOrb("idle");
      mic.onTtsEnd();
    };
    activeAudio.onerror = (e) => {
      console.error("[TTS] ✗ audio play error:", e, "error:", activeAudio?.error);
      stopServerAudio();
      if (useStore.getState().orbState === "speaking") useStore.getState().setOrb("idle");
      mic.onTtsEnd();
    };
    try {
      await activeAudio.play();
      console.log("[TTS] play() succeeded");
    } catch (playError) {
      console.error("[TTS] play() failed, trying workaround:", playError);
      // Tauri/WebKit sometimes blocks autoplay - try setting volume first
      activeAudio.volume = 1.0;
      await activeAudio.play();
    }
    return true;
  } catch (e) {
    console.error("[TTS] server TTS failed:", e);
    stopServerAudio();
    return false;
  }
}

export function speak(text: string): void {
  const state = useStore.getState();
  console.log("[TTS] speak() called, voiceEnabled:", state.voiceEnabled, "text:", text.slice(0, 50));
  if (!state.voiceEnabled) {
    console.log("[TTS] voice disabled, skipping");
    return;
  }
  
  // Wake up audio sinks (PipeWire suspend fix)
  void wakeupAudioSinks();
  
  const clean = cleanSpeechText(text);
  if (!clean) {
    console.log("[TTS] clean text is empty, skipping");
    return;
  }
  console.log("[TTS] speaking:", clean.slice(0, 80));
  // Hard-stop the streaming queue first so legacy speak() never overlaps
  // an in-progress streamSpeak burst.
  cancelStreamingTts();
  void (async () => {
    console.log("[TTS] >>> trying server TTS...");
    const result = await speakWithServerTts(clean);
    console.log("[TTS] >>> server TTS result:", result);
    if (result) {
      console.log("[TTS] >>> server TTS succeeded");
      return;
    }
    console.log("[TTS] >>> server TTS failed, trying browser TTS");
    speakWithBrowserTts(clean);
  })();
}

// ── Streaming TTS API ──────────────────────────────────────────────────────
// Called from App.tsx as assistant tokens arrive. Detects newly-completed
// sentences (anything ending in . ! ? or newline) and queues each one
// for synthesis. On `isFinal`, flushes any trailing fragment too.
// Audio segments play strictly in order; later segments wait their turn.
export function streamSpeak(id: string, fullText: string, isFinal: boolean): void {
  if (!useStore.getState().voiceEnabled) {
    console.log("[TTS:stream] voice disabled, skip");
    return;
  }

  // Wake up audio sinks on first speak (PipeWire suspend fix)
  void wakeupAudioSinks();

  // New message → reset queue + state so we don't blend two answers.
  if (id !== streamState.id) {
    console.log("[TTS:stream] NEW message id=%s → cancel previous (was %s)", id, streamState.id);
    cancelStreamingTts();
    streamState.id = id;
    streamState.spokenChars = 0;
  }

  const clean = cleanSpeechText(fullText);
  const unseen = clean.slice(streamState.spokenChars);
  if (!unseen) {
    if (isFinal) maybeMarkStreamDone();
    return;
  }

  // Match runs of text terminated by sentence punctuation. Anything before
  // the last terminator is "complete" and safe to synthesize; the tail
  // (no terminator yet) waits for more tokens.
  const re = /[^.!?؟\n]+[.!?؟\n]+/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(unseen)) !== null) {
    const seg = m[0].trim();
    if (seg.length >= 3 && /[a-z0-9\u0600-\u06FF]/i.test(seg)) {
      console.log("[TTS:stream] SENTENCE detected (%d chars): \"%s\"", seg.length, seg.slice(0, 60));
      void fetchAndEnqueue(seg);
    }
    consumed = m.index + m[0].length;
  }
  streamState.spokenChars += consumed;

  if (isFinal) {
    const tail = clean.slice(streamState.spokenChars).trim();
    if (tail.length >= 2 && /[a-z0-9\u0600-\u06FF]/i.test(tail)) {
      console.log("[TTS:stream] FINAL flush tail (%d chars): \"%s\"", tail.length, tail.slice(0, 60));
      void fetchAndEnqueue(tail);
      streamState.spokenChars = clean.length;
    }
    maybeMarkStreamDone();
  }

}

function maybeMarkStreamDone(): void {
  // If everything fetched + played, nothing to do. The audio queue's own
  // playNext() will fire mic.onTtsEnd() and reset orb when it drains.
}

async function fetchAndEnqueue(text: string): Promise<void> {
  const gen = streamGeneration;     // snapshot — detect stale fetches
  pendingFetches++;
  console.log("[TTS:fetch] START gen=%d, pendingFetches=%d, text=\"%s\"", gen, pendingFetches, text.slice(0, 50));
  try {
    const resp = await fetch(`${API_BASE}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, play_directly: true }),
    });
    if (gen !== streamGeneration) {
      console.log("[TTS:fetch] STALE (gen %d vs %d) — dropping", gen, streamGeneration);
      return;  // cancel happened while we were fetching
    }
    console.log("[TTS:fetch] response status=%d, gen=%d", resp.status, gen);
    if (!resp.ok) {
      console.warn("[TTS:fetch] server returned %d — dropping", resp.status);
      return;
    }
    const blob = await resp.blob();
    if (gen !== streamGeneration) {
      console.log("[TTS:fetch] STALE after blob — dropping");
      return;
    }
    console.log("[TTS:fetch] blob size=%d", blob.size);
    if (!blob.size) return;
    enqueueAudio(blob, gen);
  } catch (e) {
    console.warn("[TTS] segment fetch failed:", e);
  } finally {
    // Only decrement if this fetch belongs to the current generation.
    // Stale fetches (from a cancelled stream) must not touch the counter.
    if (gen === streamGeneration) {
      pendingFetches--;
      console.log("[TTS:fetch] END pendingFetches=%d", pendingFetches);
    } else {
      console.log("[TTS:fetch] END (stale gen=%d, not decrementing)", gen);
    }
  }
}

function enqueueAudio(blob: Blob, gen: number): void {
  // Final-instant generation check — if a cancel slipped in after the
  // fetch resolved but before this synchronous push, drop the blob.
  if (gen !== streamGeneration) {
    console.log("[TTS:enqueue] STALE (gen %d vs %d) — drop %d bytes", gen, streamGeneration, blob.size);
    return;
  }
  const url = URL.createObjectURL(blob);
  ttsQueue.push({ url });
  console.log("[TTS:enqueue] queued blob %d bytes, queueLen=%d, ttsPlaying=%s", blob.size, ttsQueue.length, ttsPlaying);
  if (!ttsPlaying) playNext();
}

function releaseActive() {
  if (activeUrl) {
    try { URL.revokeObjectURL(activeUrl); } catch { /* noop */ }
    activeUrl = null;
  }
}

function handleClipFinished(_reason: "ended" | "error") {
  // Called when the shared <audio> element finishes (or errors) a clip.
  // Ignore if a cancel bumped the generation while this clip was playing —
  // the queue/state already advanced and a new burst may be running.
  if (activeGeneration !== streamGeneration) {
    console.log("[TTS:play] %s ignored (stale gen %d vs %d)", _reason, activeGeneration, streamGeneration);
    releaseActive();
    return;
  }
  releaseActive();
  ttsPlaying = false;
  playNext();
}

function playNext(): void {
  if (!playerAudio) {
    // No Audio support — nothing to do; drop the queue gracefully.
    ttsQueue.length = 0;
    ttsPlaying = false;
    return;
  }
  // Re-entrancy guard: if a clip is already mid-play in the current
  // generation, do nothing. The clip's "ended" callback will advance.
  if (ttsPlaying && activeGeneration === streamGeneration) {
    return;
  }
  const next = ttsQueue.shift();
  if (!next) {
    ttsPlaying = false;
    releaseActive();
    console.log("[TTS:play] queue empty, pendingFetches=%d", pendingFetches);
    if (pendingFetches <= 0) {
      if (useStore.getState().orbState === "speaking") useStore.getState().setOrb("idle");
      mic.onTtsEnd();
    } else {
      // More clips on the way — wait briefly then re-check, but only if
      // the generation hasn't changed (cancel would have nuked the wait).
      const wakeGen = streamGeneration;
      setTimeout(() => {
        if (wakeGen === streamGeneration && !ttsPlaying) playNext();
      }, 60);
    }
    return;
  }
  // Stop anything still bound to the player (defensive — shouldn't be
  // playing, but src may be set from the previous clip).
  try { playerAudio.pause(); } catch { /* noop */ }
  releaseActive();

  activeUrl = next.url;
  activeGeneration = streamGeneration;
  ttsPlaying = true;
  console.log("[TTS:play] playing clip, remaining=%d, gen=%d", ttsQueue.length, activeGeneration);
  if (useStore.getState().orbState !== "speaking") {
    useStore.getState().setOrb("speaking");
    mic.onTtsStart();
  }
  playerAudio.src = next.url;
  // Re-fire generation check on the play() promise: if a cancel bumped
  // generation between src= and the play resolution, abort.
  const startGen = activeGeneration;
  playerAudio.play().catch((err) => {
    console.warn("[TTS:play] play() rejected:", err);
    if (startGen !== streamGeneration) return;   // cancelled
    handleClipFinished("error");
  });
}

export function cancelStreamingTts(): void {
  stopTtsAmplitudeTracking();
  // Pause the shared player FIRST — guarantees no two clips ever overlap
  // because the OS only ever plays ONE element at a time.
  if (playerAudio) {
    try {
      playerAudio.pause();
      playerAudio.currentTime = 0;
      // Clear src so the element doesn't hold a reference to a revoked URL.
      playerAudio.removeAttribute("src");
      playerAudio.load();
    } catch { /* noop */ }
  }
  releaseActive();
  // Drop every queued URL.
  for (const c of ttsQueue) {
    try { URL.revokeObjectURL(c.url); } catch { /* noop */ }
  }
  ttsQueue.length = 0;
  ttsPlaying = false;
  // Also kill legacy speak() audio and any browser SpeechSynthesis.
  stopServerAudio();
  try { SYNTH?.cancel(); } catch { /* noop */ }
  // Bump generation so all stale fetches / timeouts / play() promises
  // recognize themselves and bail.
  streamGeneration++;
  activeGeneration = streamGeneration;
  pendingFetches = 0;
  streamState.id = "";
  streamState.spokenChars = 0;
  console.log("[TTS:cancel] reset — generation now %d", streamGeneration);
}

function speakWithBrowserTts(clean: string): void {
  if (!SYNTH) return;
  stopServerAudio();
  SYNTH.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = v?.lang || "en-GB";
  u.rate = 0.94;
  u.pitch = 0.82;
  u.volume = 1.0;
  u.onstart = () => {
    useStore.getState().setOrb("speaking");
    mic.onTtsStart();
  };
  u.onend = () => {
    if (useStore.getState().orbState === "speaking") useStore.getState().setOrb("idle");
    mic.onTtsEnd();
  };
  SYNTH.speak(u);
}

export function stopSpeaking() {
  stopServerAudio();
  cancelStreamingTts();
  SYNTH?.cancel();
}
