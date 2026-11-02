import { t } from '../i18n';

/** Small text helpers shared by the screens. */

/**
 * Cleans raw Xtream episode titles:
 * "Show - S18E01 - " -> "Episode 1", "Show - S01E11 - 11. Bölüm" -> "11. Bölüm" (the localised "Episode N" is used when the title has no name).
 */
export function formatEpisodeTitle(rawTitle?: string, epNum?: number | string): string {
  let title = (rawTitle || '').trim().replace(/[\s-]+$/, '').trim();
  const parts = title.split(' - ');
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].trim();
    if (last && !/^S\d+E\d+$/i.test(last)) title = last;
  }
  if (!title || /^S\d+E\d+$/i.test(title)) return t('common.episode', { n: epNum || 1 });
  return title;
}

/** Lower-cases and folds Turkish letters and accents for search. */
export function normalizeSearch(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** "7.4" from Xtream ratings that may be 0-10, 0-100 or strings. Empty when missing. */
export function formatRating(value: unknown): string {
  const n = parseFloat(String(value ?? ''));
  if (isNaN(n) || n <= 0) return '';
  if (n > 10) return (n / 10).toFixed(1);
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** 65 -> "01:05", 3725 -> "1:02:05". */
export function formatClock(secs: number): string {
  if (!secs || isNaN(secs) || secs < 0) return '00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Dates, times and numbers are built by hand: TV browsers often ship without locale data,
// where Intl/toLocale* drops names or separators. Dates are always day.month.year, in every language.
const pad2 = (n: number) => String(n).padStart(2, '0');

/** "07:28" (24-hour). */
export function timeOfDay(d = new Date()): string {
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** "02.11.2026". */
export function shortDate(d: Date): string {
  return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
}

/** 4635 -> "4,635" (English) or "4.635" (Turkish). */
export function formatNumber(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, t('number.separator'));
}

export function yearOf(item: { releaseDate?: string; year?: string | number; release_date?: string }): string {
  const raw = item.releaseDate || item.release_date || (item.year ? String(item.year) : '');
  return raw ? String(raw).slice(0, 4) : '';
}
