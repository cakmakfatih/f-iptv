/**
 * Two UI languages: English and Turkish. The language comes from the device
 * (navigator languages); English is used when it is neither or cannot be read.
 * The user can switch it on the profile picker; the choice is remembered.
 */
import { en, type Key } from './en';
import { tr } from './tr';

export type Lang = 'en' | 'tr';
export type { Key };

export const LANGS: Array<{ code: Lang; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'tr', name: 'Türkçe' },
];

const STORAGE_KEY = 'lang_key';
export const LANG_EVENT = 'app:lang-changed';
const tables: Record<Lang, Record<Key, string>> = { en, tr };

/** The first supported language in the device's preference list, otherwise English. */
export function detectLang(): Lang {
  try {
    const nav = navigator as Navigator & { userLanguage?: string };
    const prefs = (nav.languages && nav.languages.length ? Array.from(nav.languages) : [nav.language || nav.userLanguage || '']).filter(Boolean);
    for (const p of prefs) {
      const base = String(p).toLowerCase().split(/[-_]/)[0];
      if (base === 'tr' || base === 'en') return base;
    }
  } catch {
    // no navigator: English
  }
  return 'en';
}

function load(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'tr') return saved;
  } catch {
    // storage blocked: detect
  }
  return detectLang();
}

let current: Lang = load();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export function getLang(): Lang {
  return current;
}

/** Switches the language and remembers it. Screens that show text must re-render afterwards. */
export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // not persisted
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  // Anything that formats text on its own (the clock) refreshes itself.
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LANG_EVENT));
}

/** Date/number locale of the current language (24-hour clock in both). */
export function locale(): string {
  return current === 'tr' ? 'tr-TR' : 'en-GB';
}

/** Looks a text up; {name} placeholders are replaced from `vars`. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  let s = tables[current][key] ?? en[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}
