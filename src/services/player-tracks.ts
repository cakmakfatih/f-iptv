export interface TrackNames {
  original: string;
  audio: string;
  captions: string;
  languages: Record<string, string>;
}

export interface Rendition {
  lang: string;
  label: string;
  url: string;
}

const aliases: Record<string, string> = {
  tur: 'tr', turkish: 'tr', 'türkçe': 'tr', eng: 'en', english: 'en',
  fra: 'fr', fre: 'fr', french: 'fr', spa: 'es', spanish: 'es', por: 'pt', portuguese: 'pt',
  deu: 'de', ger: 'de', german: 'de', ita: 'it', italian: 'it', rus: 'ru', russian: 'ru',
  ara: 'ar', arabic: 'ar', jpn: 'ja', japanese: 'ja', kor: 'ko', korean: 'ko', zho: 'zh', chi: 'zh', chinese: 'zh',
};

export function trackLanguage(raw: string): string {
  const code = (raw || '').trim().toLowerCase().split(/[-_]/)[0];
  return /^(und|undefined|unknown|null)$/.test(code) ? '' : aliases[code] || code;
}

export function trackLabel(track: { lang: string; label: string }, kind: 'audio' | 'captions', names: TrackNames, index: number, hint?: Rendition): string {
  const raw = (track.label || '').trim();
  const generic = !raw || /^(und|undefined|unknown|audio(?: track)?\s*\d*|track\s*\d+|subtitles?)$/i.test(raw) || /^[a-z]{2,3}(?:[-_][a-z0-9]+)*$/i.test(raw);
  const label = generic && hint?.label ? hint.label : raw;
  if (/^(original(?: audio)?|orijinal)$/i.test(label)) return names.original;
  const labelCode = trackLanguage(label);
  if (names.languages[labelCode]) return names.languages[labelCode];
  if (label && !generic) return label;
  if (hint?.label && !/^[a-z]{2,3}$/i.test(hint.label)) return hint.label;
  const lang = trackLanguage(track.lang) || trackLanguage(hint?.lang || '');
  return names.languages[lang] || (lang ? lang.toUpperCase() : `${names[kind]} ${index + 1}`);
}

function attributes(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pattern = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) out[match[1]] = match[2] ?? match[3];
  return out;
}

function mediaUrl(raw: string, base: string): string {
  try {
    const url = new URL(raw, base);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch { return ''; }
}

export function hlsRenditions(body: string, base: string): { audio: Rendition[]; captions: Rendition[] } {
  const result = { audio: [] as Rendition[], captions: [] as Rendition[] };
  if (!body.trimStart().startsWith('#EXTM3U')) return result;
  const lines = body.split(/\r?\n/).map(line => line.trim());
  const variant = attributes(lines.find(line => line.startsWith('#EXT-X-STREAM-INF:')) || '');
  for (const line of lines) {
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const a = attributes(line);
    const kind = a.TYPE === 'AUDIO' ? 'audio' : a.TYPE === 'SUBTITLES' ? 'captions' : null;
    if (!kind || (variant[a.TYPE] && a['GROUP-ID'] !== variant[a.TYPE])) continue;
    const url = a.URI ? mediaUrl(a.URI, base) : '';
    if (kind === 'captions' && !url) continue;
    result[kind].push({ lang: trackLanguage(a.LANGUAGE || ''), label: a.NAME || a.LANGUAGE || '', url });
  }
  return result;
}

export async function readTrackText(url: string, signal: AbortSignal): Promise<{ body: string; url: string }> {
  if (!mediaUrl(url, url)) throw new Error('Unsupported subtitle URL');
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) ctrl.abort();
  const timer = setTimeout(abort, 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return { body: await readTrackResponse(res), url: res.url || url };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export async function readTrackResponse(res: Response): Promise<string> {
    const limit = 2 * 1024 * 1024;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Number(res.headers.get('content-length')) > limit) {
      await res.body?.cancel();
      throw new Error('Subtitle response exceeds size limit');
    }
    let body: string;
    if (res.body?.getReader) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      body = '';
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > limit) { await reader.cancel(); throw new Error('Subtitle response exceeds size limit'); }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
      } finally { reader.releaseLock(); }
    } else {
      body = await res.text();
      if (body.length > limit) throw new Error('Subtitle response exceeds size limit');
    }
    return body.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function seconds(value: string): number {
  return value.replace(',', '.').split(':').reduce((total, n) => total * 60 + Number(n), 0);
}

function timestamp(value: number): string {
  const ms = Math.max(0, Math.round(value * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

export async function captionText(url: string, signal: AbortSignal): Promise<string> {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) ctrl.abort();
  const timer = setTimeout(abort, 30000);
  let requests = 0, size = 0;
  type Part = { text: string; start: number };
  const load = async (target: string, start: number, depth: number): Promise<Part[]> => {
    if (depth > 3 || ++requests > 1024) throw new Error('Subtitle playlist limit exceeded');
    const response = await readTrackText(target, ctrl.signal);
    const body = response.body.trim();
    size += body.length;
    if (size > 16 * 1024 * 1024) throw new Error('Subtitle size limit exceeded');
    if (body.startsWith('WEBVTT')) return [{ text: response.body, start }];
    if (!body.startsWith('#EXTM3U')) throw new Error('Source is not WebVTT');
    const segments: Array<{ url: string; start: number }> = [];
    let offset = start, duration = 0;
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('#EXTINF:')) duration = Number(line.slice(8).split(',')[0]) || 0;
      if (!line || line.startsWith('#')) continue;
      const child = mediaUrl(line, response.url);
      if (!child) throw new Error('Unsupported subtitle URL');
      segments.push({ url: child, start: offset });
      offset += duration;
      duration = 0;
    }
    if (!segments.length || segments.length > 1024) throw new Error('Empty or oversized subtitle playlist');
    if (segments.length > 1 && !body.includes('#EXT-X-ENDLIST')) throw new Error('Live subtitle playlist is not a sidecar');
    const parts: Part[][] = new Array(segments.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, segments.length) }, async () => {
      while (next < segments.length) {
        const index = next++;
        parts[index] = await load(segments[index].url, segments[index].start, depth + 1);
      }
    }));
    return parts.flat();
  };
  try {
    const parts = await load(url, 0, 0);
    let base: number | null = null;
    const bodies = parts.map(part => {
      const map = /X-TIMESTAMP-MAP=LOCAL:([^,\n]+),MPEGTS:(\d+)/.exec(part.text);
      let shift = 0;
      if (map) {
        const pts = Number(map[2]) / 90000;
        if (base == null) base = pts - part.start;
        const wrap = 8589934592 / 90000;
        let delta = pts - base;
        while (delta < part.start - wrap / 2) delta += wrap;
        while (delta > part.start + wrap / 2) delta -= wrap;
        shift = delta - seconds(map[1]);
      }
      const blocks = part.text.split(/\n{2,}/).filter(block => !block.startsWith('WEBVTT'));
      return blocks.join('\n\n').replace(/^((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/gm,
        (_match, from: string, to: string) => `${timestamp(seconds(from) + shift)} --> ${timestamp(seconds(to) + shift)}`);
    });
    return 'WEBVTT\n\n' + bodies.join('\n\n');
  } finally {
    ctrl.abort();
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
