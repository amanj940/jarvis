/**
 * JARVIS — AUTONOMOUS HOLOGRAPHIC ORCHESTRATOR (AHO)
 *
 * Directs the 3D holographic projection autonomously through natural dialogue.
 * No manual buttons or sliders required.
 *
 * Capabilities:
 *   1. Contextual Intent Detection: Opens CPU, Neural Transformer, Arc Reactor,
 *      System Blueprints, or Educational Lessons based on spoken topic.
 *   2. Kinematic Commands:
 *      - Explode / Deconstruct: "فكك المعالج", "باعد الطبقات", "explode 80%"
 *      - Assemble / Collapse: "أعد التجميع", "اجمع الطبقات", "put it back together"
 *   3. Layer Isolation & Inspection:
 *      - Focus / Isolate: "ركز على كاش L3", "اعزل شريحة السيليكون", "افحص مشتت الحرارة"
 *      - Reset: "أعد الرؤية الشاملة", "ألغِ العزل"
 *   4. Conversational Dismissal:
 *      - "شكراً جارفيس", "أغلق المجسم", "إخفاء", "كافي", "تمام", "dismiss", "hide"
 *   5. Autonomous Idle Dissolve:
 *      - Fades away after 45s of silence or when topic transitions elsewhere.
 */
import { useStore } from "./store";

// Layer dictionary mapping spoken keywords to model layer IDs
const LAYER_KEYWORDS: Record<string, { modelId: string; layerId: string; labelAr: string }> = {
  // CPU Layers
  "مشتت الحرارة": { modelId: "cpu", layerId: "heat_spreader", labelAr: "غلاف تشتيت الحرارة المعدني (IHS)" },
  "غلاف التشتيت": { modelId: "cpu", layerId: "heat_spreader", labelAr: "غلاف تشتيت الحرارة المعدني (IHS)" },
  "المشتت": { modelId: "cpu", layerId: "heat_spreader", labelAr: "غلاف تشتيت الحرارة المعدني (IHS)" },
  "heat spreader": { modelId: "cpu", layerId: "heat_spreader", labelAr: "غلاف تشتيت الحرارة المعدني (IHS)" },
  "ihs": { modelId: "cpu", layerId: "heat_spreader", labelAr: "غلاف تشتيت الحرارة المعدني (IHS)" },
  "معجون": { modelId: "cpu", layerId: "tim", labelAr: "مادة التوصيل الحراري (TIM)" },
  "التوصيل الحراري": { modelId: "cpu", layerId: "tim", labelAr: "مادة التوصيل الحراري (TIM)" },
  "tim": { modelId: "cpu", layerId: "tim", labelAr: "مادة التوصيل الحراري (TIM)" },
  "الأنوية": { modelId: "cpu", layerId: "cores_die", labelAr: "شريحة السيليكون وأنوية المعالجة المركزية" },
  "أنوية": { modelId: "cpu", layerId: "cores_die", labelAr: "شريحة السيليكون وأنوية المعالجة المركزية" },
  "السيليكون": { modelId: "cpu", layerId: "cores_die", labelAr: "شريحة السيليكون وأنوية المعالجة المركزية" },
  "cores": { modelId: "cpu", layerId: "cores_die", labelAr: "شريحة السيليكون وأنوية المعالجة المركزية" },
  "die": { modelId: "cpu", layerId: "cores_die", labelAr: "شريحة السيليكون وأنوية المعالجة المركزية" },
  "كاش": { modelId: "cpu", layerId: "l3_cache", labelAr: "ذاكرة الكاش الذكية ومسار النقل الحلقي" },
  "الذاكرة المخبأة": { modelId: "cpu", layerId: "l3_cache", labelAr: "ذاكرة الكاش الذكية ومسار النقل الحلقي" },
  "l3": { modelId: "cpu", layerId: "l3_cache", labelAr: "ذاكرة الكاش الذكية ومسار النقل الحلقي" },
  "cache": { modelId: "cpu", layerId: "l3_cache", labelAr: "ذاكرة الكاش الذكية ومسار النقل الحلقي" },
  "كرت الشاشة": { modelId: "cpu", layerId: "gpu_die", labelAr: "معالج الرسوميات المدمج (Intel UHD)" },
  "الرسوميات": { modelId: "cpu", layerId: "gpu_die", labelAr: "معالج الرسوميات المدمج (Intel UHD)" },
  "gpu": { modelId: "cpu", layerId: "gpu_die", labelAr: "معالج الرسوميات المدمج (Intel UHD)" },
  "قاعدة التوصيل": { modelId: "cpu", layerId: "substrate", labelAr: "قاعدة التوصيل ومصفوفة النقاط الذهبية" },
  "النقاط الذهبية": { modelId: "cpu", layerId: "substrate", labelAr: "قاعدة التوصيل ومصفوفة النقاط الذهبية" },
  "substrate": { modelId: "cpu", layerId: "substrate", labelAr: "قاعدة التوصيل ومصفوفة النقاط الذهبية" },

  // Neural Transformer Layers
  "الانتباه": { modelId: "neural", layerId: "attention", labelAr: "رؤوس الانتباه الذاتي (Self-Attention)" },
  "انتباه": { modelId: "neural", layerId: "attention", labelAr: "رؤوس الانتباه الذاتي (Self-Attention)" },
  "attention": { modelId: "neural", layerId: "attention", labelAr: "رؤوس الانتباه الذاتي (Self-Attention)" },
  "تغذية أمامية": { modelId: "neural", layerId: "ffn", labelAr: "مصفوفات المعالجة العميقة (FFN / SwiGLU)" },
  "أوزان": { modelId: "neural", layerId: "ffn", labelAr: "مصفوفات المعالجة العميقة (FFN / SwiGLU)" },
  "ffn": { modelId: "neural", layerId: "ffn", labelAr: "مصفوفات المعالجة العميقة (FFN / SwiGLU)" },
  "mlp": { modelId: "neural", layerId: "ffn", labelAr: "مصفوفات المعالجة العميقة (FFN / SwiGLU)" },
  "تضمين": { modelId: "neural", layerId: "embedding", labelAr: "طبقة التضمين المتجهي عالي الأبعاد" },
  "embedding": { modelId: "neural", layerId: "embedding", labelAr: "طبقة التضمين المتجهي عالي الأبعاد" },
  "توليد الكلمات": { modelId: "neural", layerId: "output_logits", labelAr: "طبقة التوزيع الاحتمالي وتوليد الكلمات" },
  "احتمالات": { modelId: "neural", layerId: "output_logits", labelAr: "طبقة التوزيع الاحتمالي وتوليد الكلمات" },
  "softmax": { modelId: "neural", layerId: "output_logits", labelAr: "طبقة التوزيع الاحتمالي وتوليد الكلمات" },

  // Arc Reactor Layers
  "ملفات مغناطيسية": { modelId: "reactor", layerId: "magnetic_coils", labelAr: "ملفات الاحتواء المغناطيسي الحلقية" },
  "مغناطيس": { modelId: "reactor", layerId: "magnetic_coils", labelAr: "ملفات الاحتواء المغناطيسي الحلقية" },
  "coils": { modelId: "reactor", layerId: "magnetic_coils", labelAr: "ملفات الاحتواء المغناطيسي الحلقية" },
  "حلقة التفاعل": { modelId: "reactor", layerId: "core_ring", labelAr: "حلقة التفاعل والاندماج الهادئ" },
  "بلازما": { modelId: "reactor", layerId: "core_ring", labelAr: "حلقة التفاعل والاندماج الهادئ" },
  "fusion ring": { modelId: "reactor", layerId: "core_ring", labelAr: "حلقة التفاعل والاندماج الهادئ" },
  "باعث الطاقة": { modelId: "reactor", layerId: "flux_emitter", labelAr: "باعث تدفق الطاقة الهولوغرافية" },
  "emitter": { modelId: "reactor", layerId: "flux_emitter", labelAr: "باعث تدفق الطاقة الهولوغرافية" },
};

class HoloOrchestrator {
  private idleDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly IDLE_TIMEOUT_MS = 45000; // 45 seconds auto-dissolve

  /**
   * Reset or start the autonomous idle dissolve countdown.
   */
  resetIdleTimer() {
    if (this.idleDismissTimer) clearTimeout(this.idleDismissTimer);
    const st = useStore.getState();
    if (st.holoState.active) {
      this.idleDismissTimer = setTimeout(() => {
        this.dissolveHolo("auto_idle_timeout");
      }, this.IDLE_TIMEOUT_MS);
    }
  }

  /**
   * Dissolve the active holographic stage gracefully.
   */
  dissolveHolo(reason = "conversational_dismiss") {
    if (this.idleDismissTimer) {
      clearTimeout(this.idleDismissTimer);
      this.idleDismissTimer = null;
    }
    const st = useStore.getState();
    if (st.holoState.active) {
      st.dismissHolo(reason);
      console.log(`[AHO] Holographic projection dissolved: ${reason}`);
    }
  }

  /**
   * Smoothly animate explode level to a target value.
   */
  animateExplode(target: number) {
    const st = useStore.getState();
    const start = st.holoState.explodeLevel;
    const diff = target - start;
    const duration = 600; // ms
    const startTime = performance.now();

    const step = (time: number) => {
      const elapsed = time - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + diff * eased);
      st.setHoloExplode(current);

      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }

  /**
   * Main entry point: Process conversational utterance from user or assistant.
   * Returns true if a holographic action was autonomously dispatched.
   */
  processUtterance(text: string, _source: "user" | "assistant"): boolean {
    if (!text) return false;
    const t = text.toLowerCase().trim();
    const st = useStore.getState();
    const isHoloActive = st.holoState.active;

    // ── 1. CONVERSATIONAL DISMISSAL (صرف الإسقاط بالعبارات الطبيعية) ───────
    const dismissTriggers = [
      "شكراً جارفيس", "شكرا جارفيس", "شكرا لك", "أغلق المجسم", "أغلق الشاشة",
      "أغلق الهولوغرام", "أغلق العرض", "إخفاء المجسم", "إخفاء", "كافي جارفيس",
      "تمام جارفيس", "كافي", "تمام", "خلاص", "يكفي", "وقف", "أوقف",
      "dismiss", "close holo", "hide holo", "shut it down", "enough",
      "turn off hologram", "close monitor", "that's all", "thank you jarvis",
      "stop hologram", "clear", "reset", "back to normal",
    ];
    // Also match regex patterns like "أغلق", "إيقاف", "انهِ"
    const dismissByPattern = /^(أغلق|اقفل|اخفي|ارجع|خلاص|يكفي|توقف|stop|close|hide|dismiss|enough|back|reset|clear)$/i.test(t);
    if (dismissByPattern || dismissTriggers.some((kw) => t.includes(kw))) {
      if (isHoloActive) {
        this.dissolveHolo("user_conversational_cue");
        return true;
      }
    }

    // ── 2. KINEMATIC COMMANDS: EXPLODE / ASSEMBLE (تفكيك / تجميع الطبقات) ───
    // Reassemble / Collapse
    if (/أعد التجميع|اجمع الطبقات|أعد تركيب|أعد الهيكل|assemble|collapse|reconstruct|put it back/i.test(t)) {
      if (isHoloActive) {
        this.animateExplode(0);
        this.resetIdleTimer();
        return true;
      }
    }

    // Explode with optional percentage
    if (/فكك|تفكيك|باعد بين|فجر الطبقات|فجر الهيكل|explode|deconstruct|separate layers/i.test(t)) {
      let pct = 80;
      const pctMatch = t.match(/(\d+)\s*(%|بالمئة|بالميه|percent)?/);
      if (pctMatch && parseInt(pctMatch[1]) > 0 && parseInt(pctMatch[1]) <= 100) {
        pct = parseInt(pctMatch[1]);
      }
      if (!isHoloActive) {
        st.openHolo({ mode: "anatomy3d", modelId: st.holoState.modelId || "cpu", explodeLevel: 0 });
      }
      this.animateExplode(pct);
      this.resetIdleTimer();
      return true;
    }

    // ── 3. LAYER ISOLATION & FOCUS (عزل الطبقات والتركيز الفردي) ───────────
    if (/ركز على|اعزل|افحص طبقة|عزل|فحص|focus on|isolate|inspect layer/i.test(t)) {
      for (const [kw, info] of Object.entries(LAYER_KEYWORDS)) {
        if (t.includes(kw)) {
          if (!isHoloActive || st.holoState.modelId !== info.modelId) {
            st.openHolo({ mode: "anatomy3d", modelId: info.modelId, explodeLevel: 65 });
          }
          st.isolateHoloLayer(info.layerId);
          this.resetIdleTimer();
          return true;
        }
      }
    }

    // Reset isolation
    if (/أعد الرؤية الشاملة|ألغِ العزل|إلغاء العزل|عرض كل الطبقات|show all layers|reset isolation/i.test(t)) {
      if (isHoloActive && st.holoState.isolated) {
        st.isolateHoloLayer(null);
        this.resetIdleTimer();
        return true;
      }
    }

    // ── 4. ROTATION & WIREFRAME (التحريك والدوران الهولوغرافي) ─────────────
    if (/دور المجسم|اقلب المجسم|دوران|spin|rotate|flip/i.test(t)) {
      if (isHoloActive) {
        st.setHoloAutoRotate(!st.holoState.autoRotate);
        this.resetIdleTimer();
        return true;
      }
    }
    if (/نمط الشبكة|شبكة هولوغرافية|wireframe/i.test(t)) {
      if (isHoloActive) {
        st.setHoloWireframe(!st.holoState.wireframe);
        this.resetIdleTimer();
        return true;
      }
    }

    // ── 5. EDUCATIONAL LESSON STEPPING (الانتقال في الخطوات التعليمية) ─────
    if (/الخطوة التالية|التالي|next step|next phase/i.test(t)) {
      if (isHoloActive && st.holoState.mode === "edu") {
        st.setHoloEduStep(st.holoState.eduStepIdx + 1);
        this.resetIdleTimer();
        return true;
      }
    }
    if (/الخطوة السابقة|السابق|previous step/i.test(t)) {
      if (isHoloActive && st.holoState.mode === "edu") {
        st.setHoloEduStep(Math.max(0, st.holoState.eduStepIdx - 1));
        this.resetIdleTimer();
        return true;
      }
    }

    // ── 6. PROACTIVE TOPIC PROJECTION (الظهور الذاتي حسب موضوع النقاش) ──────
    // A. CPU / Hardware Die, System Status & Thermal diagnostics
    if (/معالج|بروسيسور|حرارة|سخونة|intel|core i3|cpu|die|أنوية|ihs|تردد المعالج|حالة النظام|system status|فحص العتاد|استهلاك العتاد|cpu load|subsystems|المعمارية/i.test(t)) {
      if (!isHoloActive || st.holoState.modelId !== "cpu") {
        // If discussing thermal or cooling specifically, auto-isolate heat_spreader
        const isThermal = /حرارة|سخونة|تبريد|thermal|temperature|overheat/i.test(t);
        st.openHolo({
          mode: "anatomy3d",
          modelId: "cpu",
          explodeLevel: isThermal ? 65 : 45,
          selectedLayerId: isThermal ? "heat_spreader" : null,
          isolated: isThermal,
          holographicReason: isThermal ? "تشخيص الحرارة وتشتيت العتاد" : "تشريح معالج Intel Core i3 والأنوية",
        });
        this.resetIdleTimer();
        return true;
      }
    }


    // B. Neural Transformer Core & LLM Attention
    if (/محولات|transformer|عصبي|انتباه|attention|ذكاء اصطناعي|شبكة عصبية|llm|أوزان|تضمين|swiglu/i.test(t)) {
      if (!isHoloActive || st.holoState.modelId !== "neural") {
        st.openHolo({
          mode: "anatomy3d",
          modelId: "neural",
          explodeLevel: 55,
          holographicReason: "تشريح مصفوفة المحولات ورؤوس الانتباه",
        });
        this.resetIdleTimer();
        return true;
      }
    }

    // C. Arc Reactor & Fusion Power
    if (/مفاعل|arc reactor|reactor|اندماج|طاقة|بلازما|plasma|حلقة الاندماج/i.test(t)) {
      if (!isHoloActive || st.holoState.modelId !== "reactor") {
        st.openHolo({
          mode: "anatomy3d",
          modelId: "reactor",
          explodeLevel: 50,
          holographicReason: "تشريح مفاعل الطاقة الهولوغرافي",
        });
        this.resetIdleTimer();
        return true;
      }
    }

    // D. Biological DNA Double Helix & Genetics
    if (/dna|جينات|وراثة|بيولوجيا|أحياء|خلايا|حمض نووي|طب|كيمياء حيوية|جينوم|genetics|biology/i.test(t)) {
      if (!isHoloActive || st.holoState.modelId !== "dna") {
        st.openHolo({
          mode: "anatomy3d",
          modelId: "dna",
          explodeLevel: 40,
          holographicReason: "الحمض النووي والشيفرة الجينية الحلزونية",
        });
        this.resetIdleTimer();
        return true;
      }
    }

    // E. Planetary Globe, Earth, Geography & Space Orbits
    if (/كوكب|أرض|الكرة الأرضية|عالم|دول|قارات|جغرافيا|طقس|مناخ|فضاء|مدار|قمر صناعي|globe|earth|planet/i.test(t)) {
      if (!isHoloActive || st.holoState.modelId !== "globe") {
        st.openHolo({
          mode: "anatomy3d",
          modelId: "globe",
          explodeLevel: 30,
          holographicReason: "المسح الكوكبي والمجال الجغرافي ثلاثي الأبعاد",
        });
        this.resetIdleTimer();
        return true;
      }
    }

    // F. Cyber Security Shield, Encryption & Firewall
    if (/أمن|حماية|درع|أمان|تشفير|جدار ناري|أمن سيبراني|اختراق|هاكر|صلاحيات|security|shield|firewall|encryption/i.test(t)) {
      if (!isHoloActive || st.holoState.modelId !== "shield") {
        st.openHolo({
          mode: "anatomy3d",
          modelId: "shield",
          explodeLevel: 50,
          holographicReason: "منظومة الدفاع السيبراني ودرع التشفير",
        });
        this.resetIdleTimer();
        return true;
      }
    }

    // G. Holographic Floating Workspace Window, Code, Data & Blueprints
    if (/نافذة|شاشة هولوغرافية|ملف|ملفات|مستند|كود|برمجة|خوارزمية|بيانات|جدول|تقرير|document|window|workspace/i.test(t)) {
      if (!isHoloActive || st.holoState.modelId !== "window") {
        st.openHolo({
          mode: "anatomy3d",
          modelId: "window",
          explodeLevel: 35,
          holographicReason: "نافذة البيانات والمخططات الهولوغرافية",
        });
        this.resetIdleTimer();
        return true;
      }
    }

    // D. Educational Instruction Pipeline Walkthrough
    if (/كيف يعمل المعالج|دورة تنفيذ الأوامر|instruction pipeline|pipeline|درس تفاعلي/i.test(t)) {
      if (!isHoloActive || st.holoState.mode !== "edu") {
        st.openHolo({
          mode: "edu",
          eduLessonId: "cpu_pipeline",
          eduStepIdx: 0,
          eduIsPlaying: true,
          holographicReason: "درس تفاعلي: دورة تنفيذ الأوامر داخل المعالج",
        });
        this.resetIdleTimer();
        return true;
      }
    }

    // E. System Blueprints & Circuit Interconnect
    if (/مخطط|مخططات|blueprint|blueprints|دوائر النظام|هندسة المنظومة/i.test(t)) {
      if (!isHoloActive || st.holoState.mode !== "blueprint") {
        st.openHolo({
          mode: "blueprint",
          holographicReason: "المخطط الهيكلي وتدفق بيانات النظام",
        });
        this.resetIdleTimer();
        return true;
      }
    }

    // F. Generic 3D / Anatomy request
    if (/3d|ثلاثي الأبعاد|تشريح|مجسم|مجسمات|هولوغرام|holo|anatomy/i.test(t)) {
      if (!isHoloActive) {
        st.openHolo({
          mode: "anatomy3d",
          modelId: "cpu",
          explodeLevel: 45,
          holographicReason: "المعرض التشريحي ثلاثي الأبعاد",
        });
        this.resetIdleTimer();
        return true;
      }
    }

    return false;

  }
}

export const holoOrchestrator = new HoloOrchestrator();
