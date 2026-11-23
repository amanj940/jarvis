/**
 * Browser-side STT: wake-word-gated microphone capture (MediaRecorder +
 * /api/stt), VAD, barge-in / cancel-probe, live-voice mode.
 * (Phase 2 split of lib/voice.ts.)
 */
import { useStore } from "../store";
import { getHealth, API_BASE } from "../api";
import { detectWake, stripWakeWord, normalizeWakeWord, isLiveStartCommand, isLiveStopCommand } from "../wakeWord";
import { speak, cancelStreamingTts } from "./tts";

function configuredWakeWord(): string {
  return normalizeWakeWord(useStore.getState().health?.voice?.wake_word);
}

// --- STT (Server-side via MediaRecorder + /api/stt) ---
// Wake-word gated: every utterance is transcribed, but ONLY utterances
// that contain the configured wake phrase are forwarded to the chat. Other
// speech is discarded silently so the model never reacts to ambient talk.
// Once awake the mic stays "armed" for FOLLOWUP_WINDOW_MS so quick
// follow-ups don't need to repeat the wake word.

// VAD constants. SILENCE_THRESHOLD is the *floor* below which audio counts
// as silence; the actual detection threshold floats up dynamically based on
// a noise baseline learned during the first second of every mic session.
const SILENCE_THRESHOLD   = 0.05;
const SILENCE_TIMEOUT_MS  = 1100;      // silence this long = end of utterance
const MIN_RECORDING_MS    = 600;       // ignore clips shorter than this
const MAX_RECORDING_MS    = 8_000;     // force-flush clips longer than this
const BASELINE_WINDOW_MS  = 1_000;     // learn ambient noise level over 1 s
const BASELINE_MULTIPLIER = 1.8;       // require lvl > baseline * mult to count as voice

// ── Speak-time cancel ("mute mic except cancel") ────────────────────────────
// While JARVIS is speaking the mic is muted to normal commands — VAD is paused
// so we never transcribe ambient talk or our own TTS. We keep ONE ear open for
// a stop word: a sustained, clearly-louder-than-ambient voice (echo residue
// won't survive the sustain window) triggers a short "cancel-probe" recording.
// That probe is checked ONLY for "cancel"/"stop" — TTS keeps playing unless a
// stop word is actually heard. Probe audio is NEVER submitted as a chat.
const BARGE_IN_MULTIPLIER = 3.2;       // voice must exceed baseline * this
const BARGE_IN_FLOOR      = 0.12;      // and clear this absolute level
const BARGE_IN_SUSTAIN_MS = 220;       // for this long, continuously
// Stop words that cut TTS when heard during a cancel-probe.
const CANCEL_RE = /\b(?:cancel|nevermind|never\s*mind|shut\s*up|stop(?:\s+(?:talking|speaking))?|be\s+quiet|quiet|enough|hush)\b/i;
const CANCEL_PROBE_MS = 1600;          // how long to listen for the stop word

// Whisper hallucinations to suppress (mirror of server filter).
const HALLUCINATION_RE = /^\s*(?:thanks?[\s,.!?]*(?:for\s+watching|for\s+listening)?[\s,.!?]*(?:everyone|guys|all)?[\s,.!?]*|thank\s+you[\s,.!?]*(?:for\s+watching|for\s+listening|so\s+much)?[\s,.!?]*|(?:please\s+)?(?:like\s*(?:and\s+)?)?subscribe[\s,.!?]*(?:to\s+my\s+channel)?[\s,.!?]*|bye(?:\s*bye)?[\s,.!?]*|goodbye[\s,.!?]*|(?:see|catch)\s+you\s+(?:later|next\s+time)[\s,.!?]*|you[\s,.!?]*|[.!?,…\s♪♫]+)\s*$/i;
// Non-lexical interjections / vocal noise (throat-clears, "oh", "uh", "hmm").
// In the armed follow-up window these would otherwise auto-submit as a chat
// and cancel any in-flight task. Drop them — they carry no command.
const FILLER_RE = /^\s*(?:oh+|uh+|um+|hmm+|hm|ah+|aha|eh+|mm+|er+|huh|ugh|oof|whoa|oops|mhm|uh[\s-]*huh|oh\s+my|yeah|yep|nope|hu)[\s,.!?…]*$/i;
const FOLLOWUP_WAKE_MS  = 10_000;
const FOLLOWUP_REPLY_MS = 20_000;
// VAD often chops one spoken sentence into 2+ STT clips on short pauses.
// Buffer submissions this long and join consecutive clips into ONE chat, so a
// mid-sentence pause doesn't fire twice (the 2nd request cancelling the 1st).
const STT_COALESCE_MS = 800;
const SLEEP_PHRASES = /\b(?:stop listening|go to sleep|jarvis stop|sleep mode|nevermind|never mind|that's all|that is all)\b/i;

export class JarvisMic {
  private analyser: AnalyserNode | null = null;
  private audioCtx: AudioContext | null = null;
  private rafId: number | null = null;
  private stream: MediaStream | null = null;

  // Recording state
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private isRecording = false;
  private recordingStartTime = 0;
  private silenceStart = 0;
  // Rolling ambient noise floor — learned during the first second of every
  // session so we can distinguish actual speech from constant background
  // hum (fans, A/C, traffic) that would otherwise pin the VAD open forever.
  private baselineLvl = 0;
  private baselineSamples = 0;
  private baselineStartedAt = 0;
  private _wantListening = false;
  private _onTranscript: ((text: string, isFinal: boolean) => void) | null = null;
  private _onWake: ((phrase: string) => void) | null = null;
  private _transcribing = false;
  private _coalesceBuf: string[] = [];
  private _coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  // Wake-word gate
  private _awakeUntil = 0;        // unix ms; while now < this, accept everything
  private _ttsActive = false;     // JARVIS is talking — mic muted except "cancel"
  private _loudRunStart = 0;      // unix ms the current loud-while-speaking run began
  private _recordingIsProbe = false;  // current capture is a cancel-probe (never submit)
  private _probeTimer: ReturnType<typeof setTimeout> | null = null;

  // Called from voice.speak() when TTS begins / ends.
  onTtsStart() {
    this._ttsActive = true;
    this._loudRunStart = 0;
    // Drop any in-flight capture (would otherwise pick up JARVIS itself).
    if (this.isRecording) this._stopRecording();
    if (this._wantListening) {
      useStore.getState().setMicMode("speaking");
      useStore.getState().setMicStatus(
        useStore.getState().bargeIn
          ? "JARVIS speaking · say “cancel” to stop"
          : "JARVIS speaking · mic muted",
      );
    }
  }

  onTtsEnd() {
    this._ttsActive = false;
    this._loudRunStart = 0;
    // Tear down any cancel-probe still in flight; its audio must never submit.
    if (this._probeTimer) { clearTimeout(this._probeTimer); this._probeTimer = null; }
    if (this.isRecording) this._stopRecording();

    const isLive = useStore.getState().liveVoice;
    if (isLive) {
      // In Live Mode (Gemini Live style): keep listening continuously
      this._awakeUntil = Infinity;
      if (this._wantListening) {
        useStore.getState().setMicMode("live");
        useStore.getState().setOrb("listening");
        useStore.getState().setMicStatus("محادثة حية نشطة · أنا أستمع إليك…");
      }
      return;
    }

    // After JARVIS finishes, arm a generous follow-up window so the user
    // can reply naturally — no second wake word needed.
    this._awakeUntil = Date.now() + FOLLOWUP_REPLY_MS;
    if (this._wantListening) {
      useStore.getState().setMicMode("armed");
      useStore.getState().setMicStatus(`armed · ${Math.round(FOLLOWUP_REPLY_MS/1000)}s to reply`);
    }
  }

  // The user spoke up while JARVIS is talking. Start a brief recording that is
  // checked ONLY for a stop word — TTS keeps playing meanwhile. If no stop word
  // is heard the audio is discarded; it is never submitted as a chat.
  private _startCancelProbe() {
    this._loudRunStart = 0;
    if (this.isRecording || this._transcribing) return;
    console.log("[STT] loud voice while speaking — cancel-probe armed");
    this._startRecording();
    this._recordingIsProbe = true;
    if (this._probeTimer) clearTimeout(this._probeTimer);
    this._probeTimer = setTimeout(() => {
      this._probeTimer = null;
      this._stopRecording();
    }, CANCEL_PROBE_MS);
    if (this._wantListening) {
      useStore.getState().setMicStatus("listening for “cancel”…");
    }
  }

  available(): boolean {
    return Boolean(navigator.mediaDevices?.getUserMedia);
  }

  async start(onTranscript: (text: string, isFinal: boolean) => void, onWake?: (phrase: string) => void) {
    if (this._wantListening) return;
    this._wantListening = true;
    this._onTranscript = onTranscript;
    this._onWake = onWake ?? null;
    await this._initAudio();
  }

  stop() {
    this._wantListening = false;
    this._onTranscript = null;
    this._onWake = null;
    this._awakeUntil = 0;
    // Drop any buffered STT clips + cancel a pending coalesce flush so a late
    // submission can't fire after the mic is stopped.
    if (this._coalesceTimer) { clearTimeout(this._coalesceTimer); this._coalesceTimer = null; }
    this._coalesceBuf = [];
    // Tear down a cancel-probe if one is running.
    if (this._probeTimer) { clearTimeout(this._probeTimer); this._probeTimer = null; }
    this._recordingIsProbe = false;
    this._loudRunStart = 0;
    this._stopRecording();
    this._stopAudioMeter();
    useStore.getState().setMicEnabled(false);
    useStore.getState().setMicMode("dormant");
    useStore.getState().setMicStatus("");
    useStore.getState().setOrb("idle");
  }

  private async _initAudio() {
    // Load configuration before accepting speech, including on first startup.
    try {
      useStore.getState().setHealth(await getHealth());
      if (!this._wantListening) return;
    } catch {
      this._wantListening = false;
      useStore.getState().setMicStatus("cannot load voice configuration — try again");
      return;
    }
    try {
      // Echo cancellation is what makes barge-in viable: it strips most of
      // JARVIS's own TTS out of the mic signal so we don't transcribe
      // ourselves or false-trigger the interrupt detector.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      console.warn("getUserMedia denied", e);
      useStore.getState().setMicStatus("mic blocked");
      return;
    }

    this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const src = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.4;  // faster response to level changes
    src.connect(this.analyser);

    useStore.getState().setMicEnabled(true);
    useStore.getState().setOrb("listening");
    useStore.getState().setMicStatus("calibrating mic…");

    // Reset baseline state for this session.
    this.baselineLvl = 0;
    this.baselineSamples = 0;
    this.baselineStartedAt = Date.now();

    let lastLevelUpdate = 0;
    const freqData = new Uint8Array(this.analyser.frequencyBinCount);
    const tick = () => {
      if (!this.analyser || !this._wantListening) return;
      this.analyser.getByteFrequencyData(freqData);
      let sum = 0;
      for (let i = 0; i < freqData.length; i++) sum += freqData[i];
      const lvl = sum / freqData.length / 255;

      // Throttle audio level state update to 10 FPS so React doesn't re-render 60 times/sec in WebKitGTK
      const now = Date.now();
      if (now - lastLevelUpdate > 100) {
        lastLevelUpdate = now;
        useStore.getState().setAudioLevel(lvl);
      }

      // ── Baseline learning. Only samples taken before any voice has been
      //    detected count, so we learn the real ambient noise floor.
      const elapsed = Date.now() - this.baselineStartedAt;
      if (elapsed < BASELINE_WINDOW_MS && !this.isRecording) {
        this.baselineSamples++;
        this.baselineLvl =
          (this.baselineLvl * (this.baselineSamples - 1) + lvl) / this.baselineSamples;
        if (elapsed >= BASELINE_WINDOW_MS - 33 && this._wantListening) {
          useStore.getState().setMicStatus(
            `listening · noise floor ${(this.baselineLvl * 100).toFixed(1)}%`,
          );
        }
      }

      // Dynamic threshold: max(floor, baseline * multiplier). If the room
      // is loud, the threshold rises so we still detect speech as the
      // crossing event rather than pinning the VAD open permanently.
      const voiceThr = Math.max(
        SILENCE_THRESHOLD,
        this.baselineLvl * BASELINE_MULTIPLIER,
      );

      // Voice activity detection — paused while JARVIS is speaking so we
      // never transcribe our own TTS output.
      if (!this._ttsActive) {
        this._loudRunStart = 0;
        if (lvl > voiceThr) {
          this.silenceStart = 0;
          if (!this.isRecording && !this._transcribing) {
            this._startRecording();
          }
        } else if (this.isRecording) {
          if (!this.silenceStart) {
            this.silenceStart = Date.now();
          } else if (Date.now() - this.silenceStart > SILENCE_TIMEOUT_MS) {
            this._stopRecording();
          }
        }
        // Hard cap on recording length so very long utterances still flush
        // for transcription even if the user never reaches a silent moment.
        if (
          this.isRecording &&
          Date.now() - this.recordingStartTime > MAX_RECORDING_MS
        ) {
          this._stopRecording();
        }
      } else if (useStore.getState().bargeIn) {
        const isLive = useStore.getState().liveVoice;
        const loudThr = Math.max(BARGE_IN_FLOOR, this.baselineLvl * BARGE_IN_MULTIPLIER);
        if (lvl > loudThr) {
          if (!this._loudRunStart) {
            this._loudRunStart = Date.now();
          } else if (
            Date.now() - this._loudRunStart > BARGE_IN_SUSTAIN_MS &&
            !this.isRecording && !this._transcribing
          ) {
            if (isLive) {
              console.log("[LIVE] user spoke while JARVIS speaking — immediate barge-in cut");
              cancelStreamingTts();
              this._ttsActive = false;
              this._loudRunStart = 0;
              this._startRecording();
            } else {
              this._startCancelProbe();
            }
          }
        } else {
          this._loudRunStart = 0;
        }
      }

      this.rafId = requestAnimationFrame(tick);
    };
    tick();
  }

  private _startRecording() {
    if (!this.stream || this.isRecording) return;
    // Default: a normal capture. _startCancelProbe() flips this true after.
    this._recordingIsProbe = false;

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    try {
      this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    } catch (e) {
      console.warn("MediaRecorder init failed:", e);
      return;
    }

    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => {
      const duration = Date.now() - this.recordingStartTime;
      // Snapshot probe-ness now — onTtsEnd may clear it before transcription.
      const wasProbe = this._recordingIsProbe;
      this._recordingIsProbe = false;
      if (duration >= MIN_RECORDING_MS && this.chunks.length > 0) {
        const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || "audio/webm" });
        this._transcribe(blob, wasProbe);
      }
      this.chunks = [];
    };

    this.recorder.start(500);
    this.isRecording = true;
    this.recordingStartTime = Date.now();
    this.silenceStart = 0;
    useStore.getState().setMicStatus("recording…");
    console.log("[STT] recording started");
  }

  private _stopRecording() {
    if (!this.isRecording || !this.recorder) return;
    this.isRecording = false;
    try {
      if (this.recorder.state === "recording") {
        this.recorder.stop();
      }
    } catch { /* noop */ }
    this.recorder = null;
  }

  private async _transcribe(blob: Blob, isCancelProbe = false) {
    if (this._transcribing) return;
    this._transcribing = true;
    useStore.getState().setMicStatus(isCancelProbe ? "listening for “cancel”…" : "transcribing…");
    console.log("[STT] sending", blob.size, "bytes for transcription", isCancelProbe ? "(cancel-probe)" : "");

    try {
      const form = new FormData();
      form.append("audio", blob, "speech.webm");

      const resp = await fetch(`${API_BASE}/api/stt`, { method: "POST", body: form });
      const result = await resp.json();

      console.log("[STT] result:", result);

      // Cancel-probe: user spoke up while JARVIS was talking. ONLY a stop word
      // does anything here — this audio is never forwarded to the chat.
      if (isCancelProbe) {
        const probe = (result?.text || "").trim();
        if (probe && CANCEL_RE.test(probe)) {
          console.log("[STT] cancel word while speaking — cutting TTS:", probe);
          cancelStreamingTts();
          this._ttsActive = false;
          this._loudRunStart = 0;
          this._awakeUntil = Date.now() + FOLLOWUP_WAKE_MS;
          useStore.getState().setMicMode("armed");
        } else {
          console.log("[STT] cancel-probe, no stop word — ignoring:", probe || "(empty)");
        }
        return;   // probe audio is never submitted
      }

      if (result.text && this._onTranscript) {
        const text = result.text.trim();
        if (!text) return;
        // Client-side guard against Whisper's YouTube-outro hallucinations.
        // Server already filters them, this catches any that slip through.
        if (HALLUCINATION_RE.test(text)) {
          console.log("[STT] discarded hallucination:", text);
          return;
        }
        // Pure vocal noise (oh / uh / hmm) — never submit. Without this an
        // ambient "oh" in the armed window cancels whatever JARVIS is running.
        if (FILLER_RE.test(text)) {
          console.log("[STT] ignored filler:", text);
          return;
        }

        // 1. Live Mode Start: "jarvis start" / "جارفيس ابدأ"
        if (isLiveStartCommand(text)) {
          console.log("[LIVE] Live start command recognized:", text);
          useStore.getState().setLiveVoice(true);
          useStore.getState().setMicMode("live");
          useStore.getState().setOrb("listening");
          this._awakeUntil = Infinity;
          const isAr = /[\u0600-\u06FF]/.test(text);
          speak(isAr ? "أهلاً بك يا سيدي، وضع المحادثة الحية مفعّل. تفضل، أنا أستمع إليك." : "Live voice conversation active. I'm listening, sir.");
          return;
        }

        // 2. Live Mode Stop: "jarvis stop" / "جارفيس توقف" / "توقف" / "مع السلامة"
        if (isLiveStopCommand(text) || SLEEP_PHRASES.test(text)) {
          console.log("[LIVE] Live stop command recognized:", text);
          useStore.getState().setLiveVoice(false);
          this._awakeUntil = 0;
          useStore.getState().setMicMode("dormant");
          useStore.getState().setOrb("idle");
          const isAr = /[\u0600-\u06FF]/.test(text);
          speak(isAr ? "حاضر يا سيدي، تم إنهاء وضع المحادثة الحية." : "Live conversation ended, sir.");
          return;
        }

        const isLive = useStore.getState().liveVoice;
        const now = Date.now();
        const wakeWord = configuredWakeWord();
        const hasWake = detectWake(text, wakeWord);
        const inFollowup = isLive || (now < this._awakeUntil);

        if (!hasWake && !inFollowup) {
          // Ambient speech — drop. Brief visual feedback then back to dormant.
          useStore.getState().setMicMode("dormant");
          useStore.getState().setMicStatus(`(ignored) "${text.slice(0, 40)}"`);
          setTimeout(() => {
            if (this._wantListening && useStore.getState().micMode === "dormant") {
              useStore.getState().setMicStatus(`قل “jarvis start” لبدء المحادثة الحية`);
            }
          }, 1200);
          return;
        }

        // In Live Mode: the whole text is the message! Otherwise strip wake word.
        const cleaned = isLive ? text.trim() : stripWakeWord(text, wakeWord);
        if (!cleaned) {
          // Bare wake word — arm short window, no submission.
          this._awakeUntil = now + FOLLOWUP_WAKE_MS;
          useStore.getState().setMicMode("armed");
          useStore.getState().setMicStatus("awake · awaiting command");
          this._onWake?.(text);
          return;
        }

        // Real submission.
        if (isLive) {
          this._awakeUntil = Infinity;
          useStore.getState().setMicMode("live");
          useStore.getState().setMicStatus("محادثة حية · جارٍ الرد…");
        } else {
          this._awakeUntil = now + FOLLOWUP_WAKE_MS;
          useStore.getState().setMicMode("armed");
        }
        this._onWake?.(text);
        this._queueSubmit(cleaned);
      }
    } catch (e) {
      console.error("[STT] transcription failed:", e);
    } finally {
      this._transcribing = false;
      if (this._wantListening) {
        // If JARVIS is still speaking (probe didn't cancel), restore the
        // speaking status rather than the idle listening prompt.
        if (this._ttsActive) {
          useStore.getState().setMicStatus(
            useStore.getState().bargeIn
              ? "JARVIS speaking · say “cancel” to stop"
              : "JARVIS speaking · mic muted",
          );
        } else {
          useStore.getState().setMicStatus(`listening · say “${configuredWakeWord()}”`);
        }
      }
    }
  }

  // Buffer a real submission and (re)start the coalesce timer. Consecutive
  // clips within STT_COALESCE_MS join into one chat; armed window stays alive.
  private _queueSubmit(text: string) {
    this._coalesceBuf.push(text);
    if (this._coalesceTimer) clearTimeout(this._coalesceTimer);
    useStore.getState().setMicStatus("…");
    this._coalesceTimer = setTimeout(() => this._flushCoalesce(), STT_COALESCE_MS);
  }

  private _flushCoalesce() {
    if (this._coalesceTimer) { clearTimeout(this._coalesceTimer); this._coalesceTimer = null; }
    const joined = this._coalesceBuf.join(" ").replace(/\s+/g, " ").trim();
    this._coalesceBuf = [];
    if (joined && this._onTranscript) this._onTranscript(joined, true);
  }

  private _stopAudioMeter() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.analyser = null;
    this.stream = null;
    useStore.getState().setAudioLevel(0);
  }
}

export const mic = new JarvisMic();
