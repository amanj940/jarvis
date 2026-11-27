/**
 * Settings → System → Voice sub-tab (voice on/off, wake word, barge-in, STT engine, TTS voices,
 * plus the VAD calibration panel). Extracted from Settings.tsx: JSX unchanged; the voice-related
 * store selectors live here now.
 */

import type { Dispatch, SetStateAction } from "react";
import { useStore } from "../../../lib/store";
import { useTranslations } from "../../../lib/i18n";
import { Toggle } from "./ui";
import VadCalibrationPanel from "./VadCalibrationPanel";
import type { VadConfig } from "./vadConfig";

export interface SystemVoiceSectionProps {
  chatLanguage: "en" | "ar";
  setChatLanguage: Dispatch<SetStateAction<"en" | "ar">>;
  edgeRate: string;
  setEdgeRate: Dispatch<SetStateAction<string>>;
  edgeVoiceAr: string;
  setEdgeVoiceAr: Dispatch<SetStateAction<string>>;
  edgeVoiceEn: string;
  setEdgeVoiceEn: Dispatch<SetStateAction<string>>;
  ttsVolume: number;
  setTtsVolume: Dispatch<SetStateAction<number>>;
  voiceProvider: string;
  setVoiceProvider: Dispatch<SetStateAction<string>>;
  endpoint: string;
  model: string;
  vad: VadConfig;
  setVad: Dispatch<SetStateAction<VadConfig>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
}

export default function SystemVoiceSection({
  chatLanguage,
  setChatLanguage,
  edgeRate,
  setEdgeRate,
  edgeVoiceAr,
  setEdgeVoiceAr,
  edgeVoiceEn,
  setEdgeVoiceEn,
  ttsVolume,
  setTtsVolume,
  voiceProvider,
  setVoiceProvider,
  endpoint,
  model,
  vad,
  setVad,
  setDirty,
}: SystemVoiceSectionProps) {
  const lang = useStore((s) => s.language);
  const t = useTranslations(lang);

  const voiceEnabled = useStore((s) => s.voiceEnabled);

  const setVoiceEnabled = useStore((s) => s.setVoiceEnabled);

  const wakeEnabled = useStore((s) => s.wakeEnabled);

  const setWakeEnabled = useStore((s) => s.setWakeEnabled);

  const bargeIn = useStore((s) => s.bargeIn);

  const setBargeIn = useStore((s) => s.setBargeIn);

  const sttEngine = useStore((s) => s.sttEngine);

  const setSttEngine = useStore((s) => s.setSttEngine);

  const sttModel = useStore((s) => s.sttModel);

  const setSttModel = useStore((s) => s.setSttModel);

  const sttCustomEndpoint = useStore((s) => s.sttCustomEndpoint);

  const setSttCustomEndpoint = useStore((s) => s.setSttCustomEndpoint);

  const sttCustomApiKey = useStore((s) => s.sttCustomApiKey);

  const setSttCustomApiKey = useStore((s) => s.setSttCustomApiKey);

  const edgeVoice = chatLanguage === "ar" ? edgeVoiceAr : edgeVoiceEn;

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
      <Toggle label={t("sys_speak_aloud")} value={voiceEnabled} onChange={setVoiceEnabled} />
      <Toggle label={t("sys_wake_word")} value={wakeEnabled} onChange={setWakeEnabled} />
      <Toggle label={t("sys_barge_in")} value={bargeIn} onChange={setBargeIn} />
      <div className="border-t border-slate-700 pt-4 space-y-3">
        <h3 className="text-sm font-semibold text-cyan-400">{t("sys_voice_language")}</h3>
        <p className="text-xs text-slate-400 mb-2">{t("sys_voice_lang_description")}</p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => { setChatLanguage("en"); setDirty(true); }}
            className={`w-full px-4 py-3 rounded-lg transition flex items-center justify-between ${
              chatLanguage === "en"
                ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            <span className="flex items-center gap-2">
              <span>{chatLanguage === "en" ? "●" : "○"}</span>
              <span>{t("sys_voice_lang_en")}</span>
            </span>
            <span className="text-xs opacity-70">{chatLanguage === "en" ? t("active") : t("disabled")}</span>
          </button>
          <button
            type="button"
            onClick={() => { setChatLanguage("ar"); setDirty(true); }}
            className={`w-full px-4 py-3 rounded-lg transition flex items-center justify-between ${
              chatLanguage === "ar"
                ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            <span className="flex items-center gap-2">
              <span>{chatLanguage === "ar" ? "●" : "○"}</span>
              <span>{t("sys_voice_lang_ar")}</span>
            </span>
            <span className="text-xs opacity-70">{chatLanguage === "ar" ? t("active") : t("disabled")}</span>
          </button>
        </div>
      </div>
      <div className="border-t border-slate-700 pt-4 space-y-3">
        <h3 className="text-sm font-semibold text-cyan-400">TTS Provider</h3>
        <select value={voiceProvider} onChange={(e) => { setVoiceProvider(e.target.value); setDirty(true); }}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white">
          <option value="auto">Auto (best available)</option>
          <option value="edge_tts">Edge-TTS (Online, Microsoft Ryan)</option>
          <option value="piper">Piper (Local, JARVIS model)</option>
          <option value="pyttsx3">System TTS (pyttsx3 / espeak)</option>
          <option value="nvidia_riva">NVIDIA Riva (Cloud)</option>
        </select>
        <div className="space-y-2">
          <label className="text-sm text-slate-300">Edge-TTS Voice</label>
          <select value={edgeVoice} onChange={(e) => {
            if (chatLanguage === "ar") setEdgeVoiceAr(e.target.value);
            else setEdgeVoiceEn(e.target.value);
            setDirty(true);
          }}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white">
            {chatLanguage === "ar" ? (
              <>
                <option value="ar-SA-HamedNeural">Hamed Neural (Saudi, male)</option>
                <option value="ar-SA-ZariyahNeural">Zariyah Neural (Saudi, female)</option>
                <option value="ar-EG-ShakirNeural">Shakir Neural (Egyptian, male)</option>
                <option value="ar-EG-SalmaNeural">Salma Neural (Egyptian, female)</option>
                <option value="ar-YE-SalehNeural">Saleh Neural (Yemeni, male)</option>
              </>
            ) : (
              <>
                <option value="en-GB-RyanNeural">Ryan Neural (British, recommended)</option>
                <option value="en-GB-ThomasNeural">Thomas Neural (British)</option>
                <option value="en-GB-SoniaNeural">Sonia Neural (British, female)</option>
              </>
            )}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm text-slate-300">TTS Speed ({edgeRate})</label>
            <select value={edgeRate} onChange={(e) => { setEdgeRate(e.target.value); setDirty(true); }}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white">
              <option value="-20%">Slow (-20%)</option>
              <option value="-10%">Slightly slow (-10%)</option>
              <option value="-6%">Gravitas (-6%)</option>
              <option value="+0%">Normal (0%)</option>
              <option value="+10%">Fast (+10%)</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-slate-300">pyttsx3 Volume</label>
            <input type="range" min="0" max="1" step="0.1" value={ttsVolume}
              onChange={(e) => { setTtsVolume(parseFloat(e.target.value)); setDirty(true); }}
              className="w-full" />
          </div>
        </div>
      </div>

      {/* STT Speech-to-Text Engine & Dedicated Model */}
      <div className="border-t border-slate-700/80 pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-cyan-400 flex items-center gap-2">
              <span>🎙️</span>
              <bdi dir="auto">{lang === "ar" ? "محرك ونموذج تحويل الصوت إلى نص (STT)" : "Speech-to-Text (STT) Engine & Model"}</bdi>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              <bdi dir="auto">
                {lang === "ar"
                  ? "اختر محرك الاستماع المباشر (تفريغ فوري حي حرفاً بحرف أو خادم Whisper مخصص)"
                  : "Select real-time live streaming transcription or connect to a dedicated STT model"}
              </bdi>
            </p>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded border border-cyan-500/30 text-cyan-300 bg-cyan-950/40">
            <bdi dir="auto">{sttEngine === "web_speech" ? "LIVE STREAMING ⚡" : sttEngine === "custom_stt" ? "CUSTOM DEDICATED 🎯" : "WHISPER BATCH ☁️"}</bdi>
          </span>
        </div>

        {/* Engine selection tabs */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setSttEngine("web_speech")}
            className={`p-3 rounded-lg border text-left transition-all ${
              sttEngine === "web_speech"
                ? "border-cyan-400/80 bg-cyan-500/10 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                : "border-slate-800 bg-slate-900/60 hover:border-slate-700 text-slate-400"
            }`}
          >
            <div className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
              <span>⚡</span>
              <bdi dir="auto">{lang === "ar" ? "بث حي مباشر (حرفاً بحرف)" : "Browser Neural Streaming"}</bdi>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              <bdi dir="auto">
                {lang === "ar"
                  ? "ظهور الحروف والكلمات فورياً أثناء الكلام بزمن استجابة 0ms ودقة عربية عالية."
                  : "Instant word-by-word streaming typing with zero server latency."}
              </bdi>
            </p>
          </button>

          <button
            type="button"
            onClick={() => setSttEngine("backend_whisper")}
            className={`p-3 rounded-lg border text-left transition-all ${
              sttEngine === "backend_whisper"
                ? "border-cyan-400/80 bg-cyan-500/10 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                : "border-slate-800 bg-slate-900/60 hover:border-slate-700 text-slate-400"
            }`}
          >
            <div className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
              <span>☁️</span>
              <bdi dir="auto">{lang === "ar" ? "سحابة Groq Whisper" : "Cloud Whisper (Groq)"}</bdi>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              <bdi dir="auto">
                {lang === "ar"
                  ? "معالجة المقاطع عبر نموذج Whisper-large-v3-turbo على سحابة Groq."
                  : "Batch audio upload to Groq Cloud Whisper Turbo."}
              </bdi>
            </p>
          </button>

          <button
            type="button"
            onClick={() => setSttEngine("custom_stt")}
            className={`p-3 rounded-lg border text-left transition-all ${
              sttEngine === "custom_stt"
                ? "border-cyan-400/80 bg-cyan-500/10 shadow-[0_0_12px_rgba(6,182,212,0.15)]"
                : "border-slate-800 bg-slate-900/60 hover:border-slate-700 text-slate-400"
            }`}
          >
            <div className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
              <span>🎯</span>
              <bdi dir="auto">{lang === "ar" ? "نموذج مخصص / خادم محلي" : "Dedicated Custom Model"}</bdi>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              <bdi dir="auto">
                {lang === "ar"
                  ? "ربط خادم صوتي خارجي أو محلي مخصص للغة العربية (vLLM / Whisper / Riva)."
                  : "Connect your self-hosted or dedicated external STT endpoint."}
              </bdi>
            </p>
          </button>
        </div>

        {/* Custom model inputs when custom is selected */}
        {sttEngine === "custom_stt" && (
          <div className="p-3.5 rounded-lg border border-cyan-500/30 bg-slate-900/80 space-y-3 mt-2 animate-fadeIn">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">
                  <bdi dir="auto">{lang === "ar" ? "رابط نقطة النهاية (Endpoint URL)" : "Custom Endpoint URL"}</bdi>
                </label>
                <input
                  type="text"
                  value={sttCustomEndpoint}
                  onChange={(e) => setSttCustomEndpoint(e.target.value)}
                  placeholder="http://localhost:8000/v1/audio/transcriptions"
                  className="w-full bg-slate-950/80 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-cyan-300 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-300">
                  <bdi dir="auto">{lang === "ar" ? "اسم النموذج المخصص (Model Name)" : "Custom Model Identifier"}</bdi>
                </label>
                <input
                  type="text"
                  value={sttModel}
                  onChange={(e) => setSttModel(e.target.value)}
                  placeholder="whisper-large-v3-arabic"
                  className="w-full bg-slate-950/80 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-cyan-300 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-300">
                <bdi dir="auto">{lang === "ar" ? "مفتاح API اختياري (Bearer Token)" : "API Key / Bearer Token (Optional)"}</bdi>
              </label>
              <input
                type="password"
                value={sttCustomApiKey}
                onChange={(e) => setSttCustomApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full bg-slate-950/80 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-cyan-300 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
          </div>
        )}
      </div>
      <VadCalibrationPanel
        vad={vad}
        setVad={setVad}
        setDirty={setDirty}
      />
    </div>
  );
}
