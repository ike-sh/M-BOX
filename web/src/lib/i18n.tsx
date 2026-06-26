import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * 轻量 i18n：t(zh, en) 内联返回当前语言文案。
 * 设计上「未包裹的字符串自动保持中文」，因此可渐进式翻译，不会出现缺键空白。
 * 语言持久化到 localStorage，默认中文。
 */
export type Lang = "zh" | "en";

const STORAGE_KEY = "mbox-lang";

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: (zh: string, en: string) => string;
}

const I18nContext = createContext<I18nCtx>({
  lang: "zh",
  setLang: () => {},
  toggle: () => {},
  t: (zh) => zh,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem(STORAGE_KEY) as Lang) || "zh"
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  const setLang = (l: Lang) => setLangState(l);
  const toggle = () => setLangState((p) => (p === "zh" ? "en" : "zh"));
  const t = (zh: string, en: string) => (lang === "en" ? en : zh);

  return (
    <I18nContext.Provider value={{ lang, setLang, toggle, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export const useI18n = () => useContext(I18nContext);
