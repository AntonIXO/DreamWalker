import { en } from "./catalogs/en";
import { ru } from "./catalogs/ru";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  type TranslationKey,
  type TranslationSchema,
} from "./types";

export * from "./types";

const CATALOGS: Record<SupportedLocale, TranslationSchema> = {
  ru,
  en,
};

const STORAGE_KEY = "dreamwalker.locale";

let currentLocale: SupportedLocale = detectLocale();
const listeners = new Set<(locale: SupportedLocale) => void>();

function detectLocale(): SupportedLocale {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return DEFAULT_LOCALE;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (SUPPORTED_LOCALES as readonly string[]).includes(saved)) {
      return saved as SupportedLocale;
    }
    const nav = (navigator.language || "").toLowerCase();
    if (nav.startsWith("ru")) return "ru";
    if (nav.startsWith("en")) return "en";
  } catch {
    // Local storage disabled/sandboxed
  }
  return DEFAULT_LOCALE;
}

export function getLocale(): SupportedLocale {
  return currentLocale;
}

export function setLocale(locale: SupportedLocale): void {
  if (currentLocale === locale) return;
  if (!SUPPORTED_LOCALES.includes(locale)) return;
  currentLocale = locale;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, locale);
    }
  } catch {
    // Ignore storage errors
  }
  for (const listener of listeners) {
    try {
      listener(locale);
    } catch (e) {
      console.error("[i18n] listener error", e);
    }
  }
}

export function onLocaleChange(
  listener: (locale: SupportedLocale) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getNestedValue(obj: unknown, path: string): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

export function t(
  key: TranslationKey,
  params?: Record<string, string | number>,
  locale: SupportedLocale = currentLocale,
): string {
  const catalog = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
  let template = getNestedValue(catalog, key);

  if (template === undefined) {
    const fallback = CATALOGS[DEFAULT_LOCALE];
    template = getNestedValue(fallback, key);
  }

  if (template === undefined) {
    return key;
  }

  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (_, paramKey: string) => {
    return paramKey in params ? String(params[paramKey]) : `{${paramKey}}`;
  });
}
