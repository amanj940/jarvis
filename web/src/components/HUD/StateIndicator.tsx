import { useStore } from "../../lib/store";

const STATES = {
  idle: { en: "STANDBY", ar: "في الانتظار", hint: "قل «جارفس» أو اضغط الميكروفون" },
  listening: { en: "LISTENING", ar: "أستمع إليك", hint: "أنا أسمعك الآن، سيدي" },
  thinking: { en: "THINKING", ar: "أفكّر...", hint: "تحليل الطلب وتجهيز الأدوات" },
  speaking: { en: "SPEAKING", ar: "أتحدث", hint: "جارٍ نطق الرد" },
};

export default function StateIndicator() {
  const orbState = useStore((s) => s.orbState);
  const state = STATES[orbState];

  return (
    <div className="absolute left-1/2 bottom-24 -translate-x-1/2 text-center w-[min(92%,420px)] pointer-events-none z-10">
      <div className="text-[15px] font-semibold tracking-[0.38em] text-jarvis-cyan uppercase">
        {state.en}
      </div>
      <div className="text-[20px] font-light mt-0.5 text-jarvis-ice">
        {state.ar}
      </div>
      <div className="text-[12px] text-jarvis-cyan/50 mt-2">
        {state.hint}
      </div>
    </div>
  );
}
