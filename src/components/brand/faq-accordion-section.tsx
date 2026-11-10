"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const FAQ_ITEMS = [
  {
    id: "how-it-works",
    question: "كيف يعمل الملصق؟",
    answer:
      "تثبّت ملصق «بَلِّغْنِي» على زجاج سيارتك وتفعّله برقم هاتفك مرة واحدة. عند الحاجة، يمسح أي شخص رمز QR بكاميرا هاتفه ويختار سبب التنبيه، فيصلك إشعار فوري عبر واتساب ورسالة SMS في ثوانٍ.",
  },
  {
    id: "phone-privacy",
    question: "هل يظهر رقم هاتفي؟",
    answer:
      "لا يظهر رقم هاتفك إطلاقاً. جميع التنبيهات تمر عبر بوابة «بَلِّغْنِي» المشفرة بالكامل، مما يضمن حماية خصوصية رقمك ورقم الشخص المُبلِّغ 100%.",
  },
  {
    id: "app-required",
    question: "هل يحتاج الطرف الآخر لتحميل تطبيق؟",
    answer:
      "لا يحتاج لتحميل أي تطبيق نهائياً. بمجرد توجيه كاميرا أي هاتف ذكي نحو رمز QR على الملصق، تفتح صفحة البلاغ السريعة مباشرة في المتصفح.",
  },
  {
    id: "delivery-payment",
    question: "كيف يتم الاستلام والدفع؟",
    answer:
      "نوفر خدمة التوصيل السريع لكافة المدن الليبية (طرابلس، بنغازي، مصراتة، الزاوية، سبها، وبقية المناطق)، ويكون الدفع نقداً عند استلام الملصق.",
  },
];

export function FaqAccordionSection() {
  const [openId, setOpenId] = React.useState<string | null>("how-it-works");

  const toggleItem = (id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <section id="faq" className="py-16 sm:py-20">
      <div className="shell">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3.5 py-1 text-xs font-bold text-primary">
            <HelpCircle className="h-3.5 w-3.5" />
            إجابات سريعة ومختصرة
          </span>
          <h2 className="mt-3 text-2xl font-bold text-foreground sm:text-4xl">
            أسئلة شائعة
          </h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            كل ما تحتاج معرفته حول ملصق «بَلِّغْنِي» الذكي وطريقة عمله في ليبيا.
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-3xl space-y-3.5">
          {FAQ_ITEMS.map((item, idx) => {
            const isOpen = openId === item.id;
            return (
              <div
                key={item.id}
                className={cn(
                  "overflow-hidden rounded-3xl border transition-all duration-200",
                  isOpen
                    ? "border-primary/50 bg-card shadow-primary-glow"
                    : "border-border bg-card shadow-card-soft hover:border-primary/30"
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleItem(item.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 p-5 text-right sm:p-6"
                >
                  <div className="flex items-center gap-3.5">
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-mono text-xs font-black transition-colors",
                        isOpen
                          ? "bg-primary text-white"
                          : "bg-secondary text-primary"
                      )}
                    >
                      0{idx + 1}
                    </span>
                    <span className="text-base font-bold text-foreground sm:text-lg">
                      {item.question}
                    </span>
                  </div>

                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-all duration-200",
                      isOpen
                        ? "rotate-180 border-primary bg-primary text-white"
                        : "border-border bg-muted/60 text-muted-foreground"
                    )}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                    >
                      <div className="border-t border-border/60 px-5 pb-5 pt-3.5 text-sm leading-relaxed text-muted-foreground sm:px-6 sm:pb-6 sm:text-base">
                        {item.answer}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
