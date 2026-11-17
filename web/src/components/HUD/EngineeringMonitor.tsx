/**
 * ENGINEERING & ANATOMICAL HOLO-MONITOR
 *
 * 1. 3D Exploded Anatomy Inspector (CPU Die, Neural Core, Arc Reactor, Projects Universe)
 * 2. Engineering Schematics & Blueprints (System Architecture, Data Flows, Circuit Traces)
 * 3. Interactive Educational Video-like Walkthrough (Step-by-step animated lessons with audio sync)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, nextId } from "../../lib/store";
import { wsClient } from "../../lib/ws";

// ── Anatomy Models Data ─────────────────────────────────────────────────────

interface AnatomyLayer {
  id: string;
  name: string;
  nameAr: string;
  color: string;
  zOffset: number; // base position
  desc: string;
  specs: Record<string, string>;
}

interface AnatomyModelDef {
  id: string;
  title: string;
  titleAr: string;
  icon: string;
  desc: string;
  layers: AnatomyLayer[];
}

const ANATOMY_MODELS: Record<string, AnatomyModelDef> = {
  cpu: {
    id: "cpu",
    title: "CPU & Architecture Die",
    titleAr: "تشريح معالج الحاسوب والأنوية",
    icon: "🖥️",
    desc: "تشريح هندسي ثلاثي الأبعاد لمعالج Intel Core i3-10110U، مع تفكيك طبقات السيليكون، ذاكرة الكاش، وأنظمة النقل.",
    layers: [
      {
        id: "heat_spreader",
        name: "Integrated Heat Spreader (IHS)",
        nameAr: "غلاف تشتيت الحرارة المعدني (IHS)",
        color: "#94a3b8",
        zOffset: 120,
        desc: "غلاف نحاسي مطلي بالنيكل يحمي شريحة السيليكون ويوزع الحرارة بالتساوي إلى المبرد.",
        specs: { "المادة": "نحاس مطلي بالنيكل", "السُمك": "1.8 mm", "الحرارة الحالية": "42°C" },
      },
      {
        id: "tim",
        name: "Thermal Interface Layer (TIM)",
        nameAr: "مادة التوصيل الحراري عالي الكفاءة",
        color: "#38bdf8",
        zOffset: 70,
        desc: "طبقة توصيل حراري سائل/معجون تسحب الحرارة المتولدة من السيليكون وتنقلها مباشرة إلى الغلاف.",
        specs: { "التوصيل الحراري": "12.5 W/mK", "المقاومة": "منخفضة جداً" },
      },
      {
        id: "cores_die",
        name: "Silicon Compute Die & Cores",
        nameAr: "شريحة السيليكون وأنوية المعالجة المركزية",
        color: "#22d3ee",
        zOffset: 20,
        desc: "القلب الحسابي للمعالج، يحتوي على نواتين فيزيائيتين و4 خيوط معالجة (Hyper-Threading) بسرعة تصل إلى 4.10 GHz.",
        specs: { "الأنوية": "2 Cores / 4 Threads", "التردد الأساسي": "2.10 GHz", "التردد الأقصى": "4.10 GHz", "المعمارية": "Comet Lake 14nm" },
      },
      {
        id: "l3_cache",
        name: "4MB Smart L3 Cache & Ring Bus",
        nameAr: "ذاكرة الكاش الذكية ومسار النقل الحلقي",
        color: "#a855f7",
        zOffset: -30,
        desc: "ذاكرة فائقة السرعة مشتركة بين جميع الأنوية توفر زمن وصول شبه فوري للبيانات المتكررة.",
        specs: { "الحجم": "4 MB Intel Smart Cache", "زمن الوصول": "1.1 نانوثانية", "عرض النطاق": "48 GB/s" },
      },
      {
        id: "gpu_die",
        name: "Intel UHD Graphics Engine",
        nameAr: "معالج الرسوميات المدمج (Intel UHD)",
        color: "#f59e0b",
        zOffset: -80,
        desc: "محرك المعالجة الرسومية المدمج مع وحدات تنفيذية لدعم تشغيل الواجهات الهولوغرافية وشاشات 4K.",
        specs: { "المعمارية": "Intel UHD Graphics 620", "التردد": "300 - 1000 MHz", "دعم الشاشات": "DirectX 12 / OpenGL 4.5" },
      },
      {
        id: "substrate",
        name: "PCB Substrate & Contact Grid",
        nameAr: "قاعدة التوصيل ومصفوفة النقاط الذهبية",
        color: "#10b981",
        zOffset: -130,
        desc: "اللوحة الأساسية متعددة الطبقات التي تربط أنوية المعالج باللوحة الأم عبر آلاف التوصيلات الذهبية الدقيقة.",
        specs: { "المقبس": "FCBGA1528", "خطوط التوصيل": "PCIe 3.0 (16 Lanes)", "الجهد الكهربائي": "1.05 V" },
      },
    ],
  },
  neural: {
    id: "neural",
    title: "Neural Transformer AI Core",
    titleAr: "تشريح العقل الاصطناعي ومصفوفة المحولات",
    icon: "🧠",
    desc: "تشريح بنية النماذج اللغوية الكبيرة (LLM) ورؤوس الانتباه المتعددة ومصفوفات الأوزان العصبية.",
    layers: [
      {
        id: "output_logits",
        name: "Softmax Output & Logits Distribution",
        nameAr: "طبقة التوزيع الاحتمالي وتوليد الكلمات",
        color: "#ec4899",
        zOffset: 110,
        desc: "تحويل مخرجات النموذج إلى احتمالات لاختيار الكلمة التالية الأكثر منطقية وإبداعاً.",
        specs: { "حجم القاموس": "128,000 Tokens", "Temperature": "0.7", "Sampling": "Top-P 0.9" },
      },
      {
        id: "ffn",
        name: "Feed-Forward SwiGLU MLP Blocks",
        nameAr: "مصفوفات المعالجة العميقة والتغذية الأمامية",
        color: "#a855f7",
        zOffset: 50,
        desc: "طبقات الشبكة العصبية العميقة التي تحتوي على المعرفة المجردة واستخلاص العلاقات المعقدة.",
        specs: { "الأوزان المخزنة": "70 Billion Parameters", "الدقة": "FP16 / INT8 Quantized" },
      },
      {
        id: "attention",
        name: "Multi-Head Self-Attention Matrix",
        nameAr: "رؤوس الانتباه الذاتي المتعددة (Self-Attention)",
        color: "#38bdf8",
        zOffset: -20,
        desc: "حساب العلاقات وأهمية كل كلمة بالنسبة للكلمات الأخرى في سياق السؤال.",
        specs: { "رؤوس الانتباه": "64 Heads", "سياق الذاكرة": "128k Context Window" },
      },
      {
        id: "embedding",
        name: "High-Dimensional Vector Embeddings",
        nameAr: "طبقة التضمين المتجهي عالي الأبعاد",
        color: "#10b981",
        zOffset: -90,
        desc: "تحويل النصوص إلى متجهات رياضية رقمية تمثل المعنى الدلالي في فضاء متعدد الأبعاد.",
        specs: { "أبعاد المتجه": "4096 Dimensions", "النمط": "Semantic Embedding" },
      },
    ],
  },
  reactor: {
    id: "reactor",
    title: "Arc Reactor Holographic Core",
    titleAr: "تشريح مفاعل الطاقة الهولوغرافي",
    icon: "⚡",
    desc: "تشريح هندسي لقلب المفاعل ومجالات الاحتواء المغناطيسي وتدفق الطاقة.",
    layers: [
      {
        id: "flux_emitter",
        name: "Primary Energy Flux Emitter",
        nameAr: "باعث تدفق الطاقة الهولوغرافية",
        color: "#67e8f9",
        zOffset: 100,
        desc: "العدسة المركزية التي توجه نبضات الطاقة وتحافظ على استقرار حلقة البلازما.",
        specs: { "التردد الطيفي": "432 THz", "الكفاءة": "99.8%" },
      },
      {
        id: "magnetic_coils",
        name: "Toroidal Magnetic Confinement Coils",
        nameAr: "ملفات الاحتواء المغناطيسي الحلقية",
        color: "#3b82f6",
        zOffset: 30,
        desc: "ملفات فائقة التوصيل تحبس البلازما في حلقة محكمة وتمنع أي تسرب حراري.",
        specs: { "المجال المغناطيسي": "14.2 Tesla", "التبريد": "Liquid Helium" },
      },
      {
        id: "core_ring",
        name: "Palladium-Infused Reaction Ring",
        nameAr: "حلقة التفاعل والاندماج الهادئ",
        color: "#f59e0b",
        zOffset: -40,
        desc: "قلب المفاعل حيث يحدث الاندماج المستقر لإنتاج طاقة مستمرة لتشغيل محطة JARVIS.",
        specs: { "إنتاج الطاقة": "3 Gigawatts", "الاستقرار": "100% مستقر" },
      },
      {
        id: "chassis",
        name: "Titanium Alloy Structural Chassis",
        nameAr: "الهيكل الهيكلي المدرع من سبائك التيتانيوم",
        color: "#64748b",
        zOffset: -100,
        desc: "قاعدة التثبيت المقاومة للضغط والحرارة العالية مع منافذ التوصيل بالنظام المضيف.",
        specs: { "المادة": "Grade 5 Titanium", "الوزن": "خفيف جداً" },
      },
    ],
  },
};

// ── Educational Walkthrough Lessons Data ────────────────────────────────────

interface EduStep {
  step: number;
  title: string;
  titleAr: string;
  summaryAr: string;
  narrationAr: string;
  highlightLayer?: string;
  diagramState: "fetch" | "decode" | "execute" | "writeback" | "attention" | "mlp" | "output" | "kernel" | "memory";
}

interface EduLesson {
  id: string;
  title: string;
  titleAr: string;
  category: string;
  steps: EduStep[];
}

const EDU_LESSONS: Record<string, EduLesson> = {
  cpu_pipeline: {
    id: "cpu_pipeline",
    title: "How CPU Executes Code (Instruction Pipeline)",
    titleAr: "كيف يعمل معالج الحاسوب: دورة تنفيذ الأوامر",
    category: "هندسة العتاد",
    steps: [
      {
        step: 1,
        title: "Instruction Fetch (IF)",
        titleAr: "المرحلة الأولى: جلب الأمر من الذاكرة",
        summaryAr: "المعالج يجلب الأمر البرمجي التالي من ذاكرة RAM أو كاش L3 عبر مسار النقل الحلقي.",
        narrationAr: "في هذه الخطوة، يقرأ عداد الأوامر في المعالج عنوان التعليمة البرمجية التالية، ويسحبها بسرعة البرق من ذاكرة الكاش السريعة لتكون جاهزة للمعالجة.",
        highlightLayer: "l3_cache",
        diagramState: "fetch",
      },
      {
        step: 2,
        title: "Instruction Decode (ID)",
        titleAr: "المرحلة الثانية: فك تشفير الأمر وتحليله",
        summaryAr: "وحدة فك التشفير تحلل البايتات الثنائية (0 و 1) وتحدد نوع العملية الحسابية ومسجلات العمل.",
        narrationAr: "يقوم مفكك التشفير في النواة بتحليل الأصفار والآحاد وتحويلها إلى إشارات تحكم دقيقة تحدد هل العملية جمع، ضرب، نقل بيانات، أو قفز شرطي.",
        highlightLayer: "cores_die",
        diagramState: "decode",
      },
      {
        step: 3,
        title: "Execute (EX)",
        titleAr: "المرحلة الثالثة: التنفيذ داخل وحدات الحساب والمنطق ALU",
        summaryAr: "توجيه البيانات إلى وحدات الحساب والمنطق (ALU) أو وحدات الفاصلة العائمة (FPU) لإجراء العملية الحسابية.",
        narrationAr: "هنا ينبض قلب المعالج؛ تجري الترانزستورات مليارات العمليات المنطقية في أجزاء من النانو ثانية وتخرج النتيجة النهائية بدقة مطلقة.",
        highlightLayer: "cores_die",
        diagramState: "execute",
      },
      {
        step: 4,
        title: "Memory & Write-Back (WB)",
        titleAr: "المرحلة الرابعة: كتابة النتيجة وتحديث السجلات",
        summaryAr: "تخزين النتيجة النهائية في سجلات المعالج وتحديث حالة النظام ليكون جاهزاً للأمر التالي.",
        narrationAr: "أخيراً، يتم حفظ النتيجة وتحديث السجلات والمؤشرات، لتبدأ الدورة التالية فوراً بمعدل 4 مليارات دورة في الثانية الواحدة.",
        highlightLayer: "substrate",
        diagramState: "writeback",
      },
    ],
  },
  ai_thinking: {
    id: "ai_thinking",
    title: "How Large Language Models Think",
    titleAr: "كيف يفكر الذكاء الاصطناعي ونماذج اللغة الكبيرة",
    category: "الذكاء الاصطناعي",
    steps: [
      {
        step: 1,
        title: "Tokenization & Vector Embedding",
        titleAr: "المرحلة الأولى: تحويل الكلمات إلى متجهات رقمية",
        summaryAr: "تقطيع جملتك إلى أجزاء (Tokens) ثم تحويل كل جزء إلى متجه رياضي في فضاء المعاني.",
        narrationAr: "عندما تتحدث مع جارفيس، تتحول كلماتك إلى متجهات رقمية متعددة الأبعاد تلتقط المعنى العميق والدلالي لطلبك.",
        highlightLayer: "embedding",
        diagramState: "attention",
      },
      {
        step: 2,
        title: "Self-Attention Routing",
        titleAr: "المرحلة الثانية: الانتباه الذاتي وفهم السياق",
        summaryAr: "كل كلمة تنتبه وتنظر إلى باقي الكلمات لتعرف وظيفتها بدقة في سياق الجملة.",
        narrationAr: "عبر شبكة الانتباه الذاتي، يربط الذكاء الاصطناعي بين الكلمات ليفهم سياق الحديث تماماً كما يفهم العقل البشري الموقف الكامل.",
        highlightLayer: "attention",
        diagramState: "attention",
      },
      {
        step: 3,
        title: "Deep Feed-Forward Processing",
        titleAr: "المرحلة الثالثة: المرور عبر طبقات المعرفة المسبقة",
        summaryAr: "تمرير الإشارات عبر عشرات المليارات من الأوزان العصبية لاسترجاع المعلومات البرمجية والهندسية.",
        narrationAr: "تتدفق المتجهات عبر طبقات الشبكة العميقة حيث تُستحضر الخبرات والحلول البرمجية المخزنة في 70 مليار معامل رياضي.",
        highlightLayer: "ffn",
        diagramState: "mlp",
      },
      {
        step: 4,
        title: "Softmax Token Generation",
        titleAr: "المرحلة الرابعة: توليد الرد كلمة وراء كلمة",
        summaryAr: "حساب التوزيع الاحتمالي لكل كلمة واختيار الكلمة التالية بدقة حتى يكتمل الرد.",
        narrationAr: "يقوم النموذج بتوليد الكلمات المتناسقة والذكية واحدة تلو الأخرى بنمط متدفق وسريع يظهر أمامك على الشاشة.",
        highlightLayer: "output_logits",
        diagramState: "output",
      },
    ],
  },
  linux_anatomy: {
    id: "linux_anatomy",
    title: "Linux Kernel & Workstation Anatomy",
    titleAr: "تشريح نظام التشغيل لينكس (Fedora Linux 44)",
    category: "أنظمة التشغيل",
    steps: [
      {
        step: 1,
        title: "Linux Kernel Ring 0",
        titleAr: "المستوى صفر: نواة لينكس وإدارة العتاد",
        summaryAr: "النواة تتحكم مباشرة في المعالج، الذاكرة، وسائط التخزين، والأجهزة المتصلة.",
        narrationAr: "نواة لينكس هي السلطة المركزية التي تدير العتاد بأمان تام وتوزع الموارد على البرامج بدقة متناهية.",
        diagramState: "kernel",
      },
      {
        step: 2,
        title: "Systemd Init & Service Daemons",
        titleAr: "المستوى الأول: مدير الخدمات Systemd والـ Daemons",
        summaryAr: "إدارة العمليات الخلفية مثل خدمة jarvis.service وشبكات الاتصال والصوتيات.",
        narrationAr: "يعمل نظام Systemd على إدارة 50 خدمة خلفية في جهازك، بما فيها خدمة جارفيس التي تعمل بشكل مستقل وخفيف في الخلفية.",
        diagramState: "kernel",
      },
      {
        step: 3,
        title: "User Space & Shell",
        titleAr: "المستوى الثاني: بيئة المستخدم ومشاريع العمل الـ 27",
        summaryAr: "بيئة سطح المكتب XFCE، المستودعات البرمجية، وقاعدة الذاكرة الديناميكية SQLite.",
        narrationAr: "في بيئة المستخدم، يدير جارفيس مشاريعك الـ 27 وقاعدة الذاكرة التراكمية لتقديم دعم فوري لكل مهامك اليومية.",
        diagramState: "memory",
      },
    ],
  },
};

// ── Main Component ──────────────────────────────────────────────────────────

export default function EngineeringMonitor({
  onClose,
  embedded = true,
}: {
  onClose: () => void;
  embedded?: boolean;
}) {
  const holoState = useStore((s) => s.holoState);
  const monitorMode = useStore((s) => s.monitorMode);
  const setMonitorMode = useStore((s) => s.setMonitorMode);
  const selectedModelKey = useStore((s) => s.selectedAnatomyModel);
  const setSelectedModelKey = useStore((s) => s.setSelectedAnatomyModel);
  const selectedLessonKey = useStore((s) => s.selectedEduLesson);
  const setSelectedLessonKey = useStore((s) => s.setSelectedEduLesson);

  const model = ANATOMY_MODELS[selectedModelKey] || ANATOMY_MODELS.cpu;
  const lesson = EDU_LESSONS[selectedLessonKey] || EDU_LESSONS.cpu_pipeline;

  // ── Embedded Single-Screen Unified Mode (Default) ──────────────────────────
  if (embedded) {
    return (
      <div className="relative w-full h-full flex flex-col overflow-hidden select-none bg-slate-950/50 backdrop-blur-md">
        {/* Futuristic Top Bezel */}
        <div className="relative flex items-center justify-between px-4 py-2.5 border-b border-cyan-500/20 bg-slate-900/70 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative flex items-center justify-center shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping absolute opacity-70" />
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
            </div>
            <div className="min-w-0">
              <div className="text-xs md:text-sm font-bold text-cyan-200 tracking-wider flex items-center gap-2 truncate">
                <span>HOLO-ENGINEERING MK IV</span>
                {holoState.holographicReason && (
                  <span className="hidden md:inline-flex text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 truncate">
                    🎯 {holoState.holographicReason}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Mode Switcher Tabs */}
            <div className="flex items-center gap-1 p-0.5 rounded-xl bg-slate-950/80 border border-cyan-500/30">
              <button
                onClick={() => setMonitorMode("anatomy3d")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                  monitorMode === "anatomy3d"
                    ? "bg-cyan-500/30 text-cyan-200 border border-cyan-400/50 shadow-[0_0_10px_rgba(6,182,212,0.4)]"
                    : "text-slate-400 hover:text-cyan-300 hover:bg-slate-900"
                }`}
              >
                <span>🧊</span> العرض التشريحي
              </button>
              <button
                onClick={() => setMonitorMode("blueprint")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                  monitorMode === "blueprint"
                    ? "bg-cyan-500/30 text-cyan-200 border border-cyan-400/50 shadow-[0_0_10px_rgba(6,182,212,0.4)]"
                    : "text-slate-400 hover:text-cyan-300 hover:bg-slate-900"
                }`}
              >
                <span>📐</span> المخطط
              </button>
              <button
                onClick={() => setMonitorMode("edu")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                  monitorMode === "edu"
                    ? "bg-cyan-500/30 text-cyan-200 border border-cyan-400/50 shadow-[0_0_10px_rgba(6,182,212,0.4)]"
                    : "text-slate-400 hover:text-cyan-300 hover:bg-slate-900"
                }`}
              >
                <span>🎬</span> الشرح المرئي
              </button>
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg bg-slate-800/80 border border-slate-700/80 hover:border-rose-500/60 hover:bg-rose-950/50 text-slate-400 hover:text-rose-300 flex items-center justify-center text-xs transition-all cursor-pointer"
              title="إغلاق الإسقاط الهولوغرافي (ESC أو قل 'شكراً جارفيس')"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Viewport */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          {monitorMode === "anatomy3d" && (
            <Anatomy3DView
              model={model}
              selectedModelKey={selectedModelKey}
              onSelectModel={setSelectedModelKey}
            />
          )}
          {monitorMode === "blueprint" && <BlueprintView />}
          {monitorMode === "edu" && (
            <EduWalkthroughView
              lesson={lesson}
              selectedLessonKey={selectedLessonKey}
              onSelectLesson={setSelectedLessonKey}
            />
          )}
        </div>

        {/* Bottom HUD Bar */}
        <div className="px-4 py-1.5 border-t border-cyan-500/20 bg-slate-900/70 shrink-0 flex items-center justify-between text-[11px] font-mono text-cyan-400/90 gap-2">
          <div className="flex items-center gap-2 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="truncate text-slate-300">
              🎙️ صوتياً: "فكك المعالج" · "ركز على كاش L3" · "أعد التجميع" · "شكراً جارفيس للإغلاق"
            </span>
          </div>
          <span className="text-slate-500 text-[10px] shrink-0">ESC للإغلاق</span>
        </div>
      </div>
    );
  }

  // Fallback Standalone Modal Frame
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-2 md:p-6 bg-slate-950/85 backdrop-blur-xl animate-fadeIn select-none">
      <div className="relative w-full max-w-6xl h-[94vh] max-h-[920px] flex flex-col rounded-3xl border border-cyan-500/35 bg-slate-950/95 shadow-[0_0_60px_rgba(6,182,212,0.3)] overflow-hidden">
        {/* Top Bezel */}
        <div className="relative flex items-center justify-between px-6 py-3 border-b border-cyan-500/20 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center">
              <span className="w-3 h-3 rounded-full bg-cyan-400 animate-ping absolute opacity-70" />
              <span className="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
            </div>
            <div>
              <div className="text-sm md:text-base font-bold text-cyan-200 tracking-wider flex items-center gap-2">
                HOLO-ENGINEERING MONITOR · المنظومة الهولوغرافية الذاتية
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  AUTONOMOUS MK IV
                </span>
              </div>
              <div className="text-[11px] text-slate-400">
                إسقاط فضائي هولوغرافي متصل بالعتاد والذكاء الاصطناعي — قيادة صوتية وتفاعلية كاملة
              </div>
            </div>
          </div>

          {holoState.holographicReason && (
            <div className="hidden xl:flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/70 border border-cyan-400/40 text-[11px] font-mono text-cyan-200 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span>🎯 {holoState.holographicReason}</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-950/80 border border-cyan-500/30">
            <button
              onClick={() => setMonitorMode("anatomy3d")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                monitorMode === "anatomy3d"
                  ? "bg-cyan-500/30 text-cyan-200 border border-cyan-400/50 shadow-[0_0_12px_rgba(6,182,212,0.4)]"
                  : "text-slate-400 hover:text-cyan-300 hover:bg-slate-900"
              }`}
            >
              <span>🧊</span> العرض التشريحي 3D
            </button>
            <button
              onClick={() => setMonitorMode("blueprint")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                monitorMode === "blueprint"
                  ? "bg-cyan-500/30 text-cyan-200 border border-cyan-400/50 shadow-[0_0_12px_rgba(6,182,212,0.4)]"
                  : "text-slate-400 hover:text-cyan-300 hover:bg-slate-900"
              }`}
            >
              <span>📐</span> المخطط الهندسي
            </button>
            <button
              onClick={() => setMonitorMode("edu")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                monitorMode === "edu"
                  ? "bg-cyan-500/30 text-cyan-200 border border-cyan-400/50 shadow-[0_0_12px_rgba(6,182,212,0.4)]"
                  : "text-slate-400 hover:text-cyan-300 hover:bg-slate-900"
              }`}
            >
              <span>🎬</span> الشرح التعليمي كالفيديو
            </button>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800/80 border border-slate-700/80 hover:border-rose-500/60 hover:bg-rose-950/50 text-slate-400 hover:text-rose-300 flex items-center justify-center text-sm transition-all cursor-pointer"
            title="إغلاق الشاشة (ESC أو قل 'شكراً جارفيس')"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden relative">
          {monitorMode === "anatomy3d" && (
            <Anatomy3DView
              model={model}
              selectedModelKey={selectedModelKey}
              onSelectModel={setSelectedModelKey}
            />
          )}
          {monitorMode === "blueprint" && <BlueprintView />}
          {monitorMode === "edu" && (
            <EduWalkthroughView
              lesson={lesson}
              selectedLessonKey={selectedLessonKey}
              onSelectLesson={setSelectedLessonKey}
            />
          )}
        </div>

        <div className="px-6 py-2.5 border-t border-cyan-500/20 bg-slate-900/85 shrink-0 flex flex-wrap items-center justify-between text-xs font-mono text-cyan-400/90 gap-2">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>HOLO-AI DIRECT ONLINE</span>
            </span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-300">
              🎙️ التحكم الصوتي: قل "فكك المعالج" · "ركز على كاش L3" · "أعد التجميع" · "شكراً جارفيس للإغلاق"
            </span>
          </div>
          <span className="text-slate-400 text-[11px]">ESC أو قل "شكراً جارفيس" للعودة</span>
        </div>
      </div>
    </div>
  );
}

// ── 1. 3D Exploded Anatomy Inspector Component ──────────────────────────────

function Anatomy3DView({
  model,
  selectedModelKey,
  onSelectModel,
}: {
  model: AnatomyModelDef;
  selectedModelKey: string;
  onSelectModel: (k: string) => void;
}) {
  const holoState = useStore((s) => s.holoState);
  const stats = useStore((s) => s.stats);
  const setHoloExplode = useStore((s) => s.setHoloExplode);
  const isolateHoloLayer = useStore((s) => s.isolateHoloLayer);
  const setHoloAutoRotate = useStore((s) => s.setHoloAutoRotate);
  const setHoloWireframe = useStore((s) => s.setHoloWireframe);
  const setHoloRotation = useStore((s) => s.setHoloRotation);
  const pushChat = useStore((s) => s.pushChat);
  const connected = useStore((s) => s.connected);

  const explode = holoState.explodeLevel;
  const wireframe = holoState.wireframe;
  const autoRotate = holoState.autoRotate;
  const rotation = holoState.rotation;
  const isolated = holoState.isolated;
  const selectedLayerId = holoState.selectedLayerId;

  // Selected layer derived from holoState or model default
  const selectedLayer = useMemo(() => {
    if (selectedLayerId) {
      const match = model.layers.find((l) => l.id === selectedLayerId);
      if (match) return match;
    }
    return model.layers[1] || model.layers[0];
  }, [model, selectedLayerId]);

  const draggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // Auto rotation loop
  useEffect(() => {
    if (!autoRotate) return;
    const t = setInterval(() => {
      if (!draggingRef.current) {
        setHoloRotation({ ...rotation, y: (rotation.y + 0.35) % 360 });
      }
    }, 30);
    return () => clearInterval(t);
  }, [autoRotate, rotation, setHoloRotation]);

  const onMouseDown = (e: React.MouseEvent) => {
    draggingRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    setHoloRotation({
      x: Math.max(-60, Math.min(60, rotation.x - dy * 0.4)),
      y: (rotation.y + dx * 0.5) % 360,
    });
  };

  const onMouseUp = () => {
    draggingRef.current = false;
  };

  const askJarvisAboutLayer = (layer: AnatomyLayer) => {
    const prompt = `اشرح لي هندسياً وتشريحياً وظيفة "${layer.nameAr} (${layer.name})"، وما هي أهميتها في عمل النظام؟`;
    pushChat({
      id: nextId(),
      role: "user",
      text: prompt,
      ts: Date.now(),
    });
    if (connected) {
      wsClient.chat(prompt);
    }
  };

  // Helper to dynamically enrich specs with live Linux machine telemetry
  const getDynamicSpecs = (layer: AnatomyLayer): Record<string, string> => {
    const s = { ...layer.specs };
    if (model.id === "cpu" && stats) {
      if (layer.id === "cores_die") {
        s["الأنوية الحقيقية"] = `${stats.cpu_count || 2} Cores / ${(stats.cpu_count || 2) * 2} Threads`;
        s["الضغط اللحظي"] = `${stats.cpu.toFixed(1)}%`;
      } else if (layer.id === "heat_spreader") {
        if (stats.gpu?.temp_c) {
          s["الحرارة الحالية"] = `${stats.gpu.temp_c}°C`;
        }
      } else if (layer.id === "gpu_die") {
        if (stats.gpu?.load_percent !== undefined) {
          s["استهلاك الرسوميات"] = `${stats.gpu.load_percent}%`;
        }
      } else if (layer.id === "substrate") {
        if (stats.os) {
          s["نظام التشغيل"] = `${stats.os.system} (${stats.os.release})`;
        }
      }
    }
    return s;
  };

  return (
    <div className="w-full h-full flex flex-col md:flex-row overflow-hidden select-none">
      {/* Left 3D Viewport */}
      <div
        className="flex-1 relative h-full flex flex-col items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing bg-[radial-gradient(ellipse_at_center,_rgba(6,182,212,0.12)_0%,_transparent_75%)]"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        {/* Model Selector Bar */}
        <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
          {Object.values(ANATOMY_MODELS).map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onSelectModel(m.id);
                isolateHoloLayer(null);
              }}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer backdrop-blur-md ${
                selectedModelKey === m.id
                  ? "bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                  : "bg-slate-900/60 border-slate-700/60 text-slate-400 hover:text-cyan-300"
              }`}
            >
              <span>{m.icon}</span>
              <span>{m.titleAr}</span>
            </button>
          ))}
        </div>

        {/* 3D Visualizer Canvas / CSS 3D Stage */}
        <div
          className="relative w-[360px] h-[360px] md:w-[460px] md:h-[460px] flex items-center justify-center"
          style={{
            perspective: "1000px",
          }}
        >
          {/* Transforming 3D Cube & Layers Stage */}
          <div
            className="relative w-full h-full flex items-center justify-center transition-transform duration-75"
            style={{
              transformStyle: "preserve-3d",
              transform: `rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
            }}
          >
            {/* Hologram Core Orbit Rings */}
            <div
              className="absolute w-72 h-72 rounded-full border border-cyan-500/30 border-dashed pointer-events-none"
              style={{
                transform: "rotateX(90deg) translateZ(0px)",
              }}
            />
            <div
              className="absolute w-96 h-96 rounded-full border border-cyan-500/20 pointer-events-none"
              style={{
                transform: "rotateX(90deg) translateZ(-40px)",
              }}
            />

            {/* Exploded Layers */}
            {model.layers.map((layer) => {
              // Calculate spatial offset based on explode level
              const explodeMultiplier = explode / 50; // 0 = flat, 2 = max exploded
              const currentZ = layer.zOffset * explodeMultiplier;
              const isSelected = selectedLayer?.id === layer.id;
              const isTarget = isolated && selectedLayerId === layer.id;
              const isDimmed = isolated && selectedLayerId && selectedLayerId !== layer.id;

              return (
                <div
                  key={layer.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    isolateHoloLayer(layer.id);
                  }}
                  className={`absolute w-52 h-52 md:w-64 md:h-64 rounded-2xl border-2 transition-all duration-500 flex flex-col items-center justify-center cursor-pointer group shadow-2xl ${
                    wireframe
                      ? "border-dashed bg-transparent"
                      : isTarget || isSelected
                        ? "border-cyan-300 bg-cyan-950/80 shadow-[0_0_35px_rgba(34,211,238,0.6)]"
                        : "border-cyan-500/40 bg-slate-900/60 hover:border-cyan-400 hover:bg-cyan-950/40"
                  }`}
                  style={{
                    transform: `translateZ(${currentZ + (isTarget ? 35 : 0)}px) scale(${isTarget ? 1.06 : 1})`,
                    opacity: isDimmed ? 0.2 : 1,
                    filter: isDimmed ? "grayscale(85%) blur(1.5px)" : undefined,
                    boxShadow: isSelected || isTarget
                      ? `0 0 30px ${layer.color}aa, inset 0 0 15px ${layer.color}44`
                      : "0 10px 25px rgba(0,0,0,0.5)",
                    borderColor: isSelected || isTarget ? layer.color : undefined,
                  }}
                >
                  {/* Subtle Grid Circuit Lines */}
                  <div
                    className="absolute inset-2 rounded-xl border border-cyan-500/20 pointer-events-none"
                    style={{
                      backgroundImage:
                        "radial-gradient(circle, rgba(34,211,238,0.15) 1px, transparent 1px)",
                      backgroundSize: "16px 16px",
                    }}
                  />

                  {/* Layer Label Pin */}
                  <div className="relative z-10 flex flex-col items-center text-center p-3">
                    <span
                      className="w-3 h-3 rounded-full mb-1 shadow-md"
                      style={{ backgroundColor: layer.color }}
                    />
                    <span className="text-xs md:text-sm font-bold text-slate-100 group-hover:text-cyan-200 transition-colors">
                      {layer.nameAr}
                    </span>
                    <span className="text-[10px] font-mono text-cyan-400/80">
                      {layer.name}
                    </span>
                  </div>

                  {/* Corner Tech Accents */}
                  <div className="absolute top-1.5 left-1.5 w-2.5 h-2.5 border-t-2 border-l-2 border-cyan-400" />
                  <div className="absolute top-1.5 right-1.5 w-2.5 h-2.5 border-t-2 border-r-2 border-cyan-400" />
                  <div className="absolute bottom-1.5 left-1.5 w-2.5 h-2.5 border-b-2 border-l-2 border-cyan-400" />
                  <div className="absolute bottom-1.5 right-1.5 w-2.5 h-2.5 border-b-2 border-r-2 border-cyan-400" />
                </div>
              );
            })}
          </div>
        </div>

        {/* 3D Controls Overlay Bar */}
        <div className="absolute bottom-4 left-4 right-4 z-20 flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-slate-900/80 border border-cyan-500/30 backdrop-blur-md">
          {/* Exploded View Slider */}
          <div className="flex items-center gap-3 flex-1 min-w-[200px]">
            <span className="text-xs font-mono text-cyan-300 font-bold whitespace-nowrap flex items-center gap-1.5">
              <span>💥</span> التفكيك التشريحي: {explode}%
            </span>
            <input
              type="range"
              min="0"
              max="100"
              value={explode}
              onChange={(e) => setHoloExplode(Number(e.target.value))}
              className="flex-1 accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
            />
          </div>

          {/* Quick Toggles */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setHoloAutoRotate(!autoRotate)}
              className={`px-3 py-1 rounded-lg border text-xs font-mono transition-all cursor-pointer ${
                autoRotate
                  ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
                  : "bg-slate-800 border-slate-700 text-slate-400"
              }`}
            >
              🔄 دوران تلقائي {autoRotate ? "ON" : "OFF"}
            </button>
            <button
              onClick={() => setHoloWireframe(!wireframe)}
              className={`px-3 py-1 rounded-lg border text-xs font-mono transition-all cursor-pointer ${
                wireframe
                  ? "bg-cyan-500/20 border-cyan-400 text-cyan-200"
                  : "bg-slate-800 border-slate-700 text-slate-400"
              }`}
            >
              🕸️ شبكي {wireframe ? "ON" : "OFF"}
            </button>
          </div>
        </div>
      </div>

      {/* Right Engineering Specs Drawer */}
      <div className="w-full md:w-80 lg:w-96 border-t md:border-t-0 md:border-r border-cyan-500/25 bg-slate-900/90 p-5 flex flex-col justify-between overflow-y-auto">
        {selectedLayer ? (
          <div className="space-y-4">
            <div className="border-b border-cyan-500/20 pb-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 text-xs font-mono text-cyan-400">
                  <span
                    className="w-2.5 h-2.5 rounded-full shadow-sm"
                    style={{ backgroundColor: selectedLayer.color }}
                  />
                  <span>ANATOMICAL LAYER SPECIFICATION</span>
                </div>
                {isolated && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 animate-pulse">
                    ISOLATED
                  </span>
                )}
              </div>
              <h3 className="text-base font-bold text-slate-100">
                {selectedLayer.nameAr}
              </h3>
              <p className="text-xs font-mono text-cyan-400/80">
                {selectedLayer.name}
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/60 border border-cyan-500/20 text-xs text-slate-300 leading-relaxed">
              {selectedLayer.desc}
            </div>

            {/* Specs Table with Live Hardware Enrichment */}
            <div className="space-y-2">
              <span className="text-[11px] font-mono text-cyan-400 tracking-wider uppercase font-semibold">
                المواصفات التقنية والعتاد الحقيقي:
              </span>
              <div className="rounded-xl border border-slate-800 bg-slate-950/40 overflow-hidden divide-y divide-slate-800/80">
                {Object.entries(getDynamicSpecs(selectedLayer)).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="text-slate-400">{k}</span>
                    <span className="font-mono text-cyan-200 font-medium">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Isolation reset toggle */}
            {isolated && (
              <button
                onClick={() => isolateHoloLayer(null)}
                className="w-full py-1.5 px-3 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-200 text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>👁️</span> إلغاء العزل وإعادة إظهار كل الطبقات
              </button>
            )}

            {/* Ask JARVIS button */}
            <button
              onClick={() => askJarvisAboutLayer(selectedLayer)}
              className="w-full py-2.5 px-4 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-200 text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md hover:shadow-cyan-500/20"
            >
              <span>💬</span> اسأل جارفيس عن هذا المكون بالتفصيل
            </button>
          </div>
        ) : (
          <div className="text-center py-16 text-slate-400 text-xs">
            انقر على أي طبقة في المجسم الثلاثي الأبعاد أو تحدث مع جارفيس لعزلها وفحصها
          </div>
        )}

        {/* Architecture Note */}
        <div className="pt-4 border-t border-slate-800 text-[10.5px] font-mono text-slate-500 flex items-center justify-between">
          <span>MODE: 3D ANATOMICAL INSPECTION</span>
          <span>360° ORBIT</span>
        </div>
      </div>
    </div>
  );
}

// ── 2. Engineering Schematics & Blueprint Component ─────────────────────────

function BlueprintView() {
  const [activeNode, setActiveNode] = useState<string>("brain");
  const pushChat = useStore((s) => s.pushChat);
  const connected = useStore((s) => s.connected);

  const nodes = [
    {
      id: "input",
      title: "User Input Interface",
      titleAr: "واجهة إدخال المستخدم",
      icon: "🎙️",
      role: "التقاط الصوت عبر Whisper ومفاتيح الاختصار والأوامر النصية",
      status: "ACTIVE",
    },
    {
      id: "brain",
      title: "LLM Brain (Gemini 3.5 + Groq)",
      titleAr: "العقل المعرفي (Gemini + Groq Fallback)",
      icon: "🧠",
      role: "الاستدلال المنطقي، التفكير التوليدي، وتوزيع المهام",
      status: "PRIMARY ONLINE",
    },
    {
      id: "orch",
      title: "Tool & Agent Orchestrator",
      titleAr: "منسق الوكلاء والأدوات الذاتية",
      icon: "⚙️",
      role: "تنسيق 91 أداة و9 وكلاء أذكياء مع إدارة صلاحيات صارمة",
      status: "91 TOOLS READY",
    },
    {
      id: "memory",
      title: "SQLite Dynamic Memory Store",
      titleAr: "مستودع الذاكرة الديناميكية (SQLite)",
      icon: "🗄️",
      role: "تخزين الجلسات، ملف المضيف، وفهرسة المشاريع الـ 27",
      status: "27 PROJECTS INDEXED",
    },
    {
      id: "kernel",
      title: "Fedora Linux Kernel & D-Bus",
      titleAr: "نواة لينكس وخدمات Systemd",
      icon: "🐧",
      role: "تنفيذ الأوامر، مراقبة العتاد، إدارة العمليات والشبكة",
      status: "DAEMON RUNNING",
    },
    {
      id: "output",
      title: "Speech & Holo-HUD Rendering",
      titleAr: "توليد النطق والشاشة الهولوغرافية",
      icon: "🔊",
      role: "نطق الإجابات بصوت Kokoro وتحريك الواجهات الهندسية الحية",
      status: "60 FPS READY",
    },
  ];

  return (
    <div className="w-full h-full flex flex-col p-6 overflow-y-auto bg-[linear-gradient(to_right,#0284c70a_1px,transparent_1px),linear-gradient(to_bottom,#0284c70a_1px,transparent_1px)] bg-[size:24px_24px]">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-cyan-200 flex items-center gap-2">
            <span>📐</span> المخطط الهندسي المعماري لمنظومة JARVIS
          </h2>
          <p className="text-xs text-slate-400">
            مخطط تفاعلي حي يوضح تدفق البيانات بين الإدخال، العقل الاصطناعي، الأدوات، ونواة نظام التشغيل
          </p>
        </div>
        <span className="text-xs font-mono px-3 py-1 rounded-lg bg-cyan-950/60 border border-cyan-500/30 text-cyan-300">
          ARCH-DIAGRAM V4.2
        </span>
      </div>

      {/* Interactive Blueprint Flow Chart */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1">
        {nodes.map((node) => {
          const isSelected = activeNode === node.id;
          return (
            <div
              key={node.id}
              onClick={() => setActiveNode(node.id)}
              className={`p-5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between gap-3 shadow-lg ${
                isSelected
                  ? "border-cyan-400 bg-cyan-950/50 shadow-[0_0_25px_rgba(6,182,212,0.35)]"
                  : "border-slate-800 bg-slate-900/60 hover:border-cyan-500/40 hover:bg-slate-900/90"
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">{node.icon}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    {node.status}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-slate-100 mb-1">
                  {node.titleAr}
                </h3>
                <div className="text-[11px] font-mono text-cyan-400/80 mb-2">
                  {node.title}
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {node.role}
                </p>
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>انقر للفحص</span>
                <span className="text-cyan-400">CONNECT ›</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 3. Educational Walkthrough / Video-like Player Component ────────────────

function EduWalkthroughView({
  lesson,
  selectedLessonKey,
  onSelectLesson,
}: {
  lesson: EduLesson;
  selectedLessonKey: string;
  onSelectLesson: (k: string) => void;
}) {
  const holoState = useStore((s) => s.holoState);
  const setHoloEduStep = useStore((s) => s.setHoloEduStep);
  const setHoloEduPlaying = useStore((s) => s.setHoloEduPlaying);
  const pushChat = useStore((s) => s.pushChat);
  const connected = useStore((s) => s.connected);

  const currentStepIdx = holoState.eduStepIdx;
  const isPlaying = holoState.eduIsPlaying;
  const step = lesson.steps[currentStepIdx] || lesson.steps[0];
  const totalSteps = lesson.steps.length;

  // Auto-play timer
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      if (currentStepIdx < totalSteps - 1) {
        setHoloEduStep(currentStepIdx + 1);
      } else {
        setHoloEduPlaying(false);
        setHoloEduStep(0);
      }
    }, 9000);
    return () => clearInterval(timer);
  }, [isPlaying, currentStepIdx, totalSteps, setHoloEduStep, setHoloEduPlaying]);

  const speakCurrentStep = () => {
    const text = step.narrationAr;
    pushChat({
      id: nextId(),
      role: "assistant",
      text: `[شرح تعليمي مرئي] ${step.titleAr}: ${text}`,
      ts: Date.now(),
    });
  };

  return (
    <div className="w-full h-full flex flex-col p-6 overflow-hidden">
      {/* Course Selector Tabs */}
      <div className="flex items-center justify-between pb-4 border-b border-cyan-500/20 shrink-0">
        <div className="flex items-center gap-2">
          {Object.values(EDU_LESSONS).map((l) => (
            <button
              key={l.id}
              onClick={() => {
                onSelectLesson(l.id);
                setHoloEduStep(0);
              }}
              className={`px-3.5 py-1.5 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                selectedLessonKey === l.id
                  ? "bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                  : "bg-slate-900/60 border-slate-700/60 text-slate-400 hover:text-cyan-300"
              }`}
            >
              <span>🎓</span>
              <span>{l.titleAr}</span>
            </button>
          ))}
        </div>

        <span className="text-xs font-mono text-cyan-400 px-2.5 py-1 rounded bg-cyan-950/60 border border-cyan-500/30">
          المرحلة {currentStepIdx + 1} من {totalSteps}
        </span>
      </div>

      {/* Main Educational Presentation Stage (Video-like Visuals) */}
      <div className="flex-1 my-4 rounded-2xl border-2 border-cyan-500/30 bg-slate-950/80 p-6 flex flex-col justify-between relative overflow-hidden shadow-inner">
        {/* Animated Background Flow */}
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 50%, rgba(34,211,238,0.2) 0%, transparent 60%)",
          }}
        />

        {/* Step Header */}
        <div className="relative z-10 flex items-start justify-between">
          <div>
            <div className="text-xs font-mono text-cyan-400 mb-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <span>STEP 0{currentStepIdx + 1} · {step.title}</span>
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-slate-100">
              {step.titleAr}
            </h2>
          </div>
          <button
            onClick={speakCurrentStep}
            className="px-3.5 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/50 text-cyan-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
            title="نطق هذا المقطع الصوتي بواسطة جارفيس"
          >
            <span>🔊</span> نطق الشرح
          </button>
        </div>

        {/* Central Animated Graphic Canvas */}
        <div className="relative z-10 flex items-center justify-center py-6">
          <div className="w-full max-w-lg p-5 rounded-2xl border border-cyan-500/30 bg-slate-900/80 shadow-2xl flex items-center justify-around gap-4 text-center">
            <div className="flex flex-col items-center gap-2">
              <div className="w-14 h-14 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-2xl shadow-[0_0_15px_rgba(34,211,238,0.3)] animate-bounce">
                ⚙️
              </div>
              <span className="text-xs font-bold text-cyan-200">البيانات / الأمر</span>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <span className="w-full h-1 bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 rounded-full animate-pulse" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-14 h-14 rounded-2xl bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-2xl shadow-[0_0_15px_rgba(168,85,247,0.3)]">
                🧠
              </div>
              <span className="text-xs font-bold text-purple-200">المعالجة الحسابية</span>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <span className="w-full h-1 bg-gradient-to-r from-purple-500 via-emerald-500 to-teal-500 rounded-full animate-pulse" />
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-2xl shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                ✨
              </div>
              <span className="text-xs font-bold text-emerald-200">النتيجة النهائية</span>
            </div>
          </div>
        </div>

        {/* Narration Box */}
        <div className="relative z-10 p-4 rounded-xl bg-slate-900/90 border border-cyan-500/20 text-slate-200 text-sm leading-relaxed shadow-lg">
          <p className="font-semibold text-cyan-300 mb-1">{step.summaryAr}</p>
          <p className="text-xs text-slate-300 leading-normal">{step.narrationAr}</p>
        </div>
      </div>

      {/* Video-style Timeline & Playback Controller */}
      <div className="p-3.5 rounded-2xl bg-slate-900/90 border border-cyan-500/30 flex items-center justify-between gap-4 shrink-0">
        {/* Play / Pause / Navigation Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHoloEduStep(Math.max(0, currentStepIdx - 1))}
            disabled={currentStepIdx === 0}
            className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 hover:border-cyan-400 text-slate-300 hover:text-cyan-200 flex items-center justify-center text-sm disabled:opacity-30 cursor-pointer"
            title="المرحلة السابقة"
          >
            ⏮
          </button>
          <button
            onClick={() => setHoloEduPlaying(!isPlaying)}
            className="px-4 h-9 rounded-xl bg-cyan-500/30 border border-cyan-400 text-cyan-100 hover:bg-cyan-500/40 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
          >
            {isPlaying ? "❚❚ إيقاف مؤقت" : "▶ تشغيل العرض"}
          </button>
          <button
            onClick={() => setHoloEduStep(Math.min(totalSteps - 1, currentStepIdx + 1))}
            disabled={currentStepIdx === totalSteps - 1}
            className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 hover:border-cyan-400 text-slate-300 hover:text-cyan-200 flex items-center justify-center text-sm disabled:opacity-30 cursor-pointer"
            title="المرحلة التالية"
          >
            ⏭
          </button>
        </div>

        {/* Step Progress Dots */}
        <div className="flex-1 flex items-center justify-center gap-2 px-4">
          {lesson.steps.map((s, idx) => (
            <button
              key={idx}
              onClick={() => setHoloEduStep(idx)}
              className={`h-2.5 rounded-full transition-all cursor-pointer ${
                idx === currentStepIdx
                  ? "w-8 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
                  : idx < currentStepIdx
                    ? "w-3 bg-cyan-600/60"
                    : "w-3 bg-slate-700"
              }`}
              title={`الانتقال إلى: ${s.titleAr}`}
            />
          ))}
        </div>

        {/* Lesson Category Badge */}
        <div className="text-xs font-mono text-slate-400">
          تصنيف: <span className="text-cyan-300">{lesson.category}</span>
        </div>
      </div>
    </div>
  );
}
