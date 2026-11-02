import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import dns from 'node:dns/promises';
import net from 'node:net';

/*
 * Image proxy for the LAN server (dev and preview): GET /img?u=<image url>.
 *
 * Channel logos live on many third-party hosts. TVs often cannot reach some of
 * them (old TLS roots, DNS blocks, hotlink checks), so the app asks this server
 * to fetch them instead. Only public http(s) hosts and image responses pass.
 */

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 500;
const MAX_REDIRECTS = 3;
const cache = new Map<string, { type: string; body: Buffer }>();

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('blocked');
}

async function readCapped(res: Response): Promise<Buffer> {
  const length = Number(res.headers.get('content-length') || 0);
  if (length > MAX_BYTES || !res.body) throw new Error('size');
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error('size');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function fetchImage(start: string): Promise<{ type: string; body: Buffer }> {
  let url = new URL(start);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', accept: 'image/*,*/*;q=0.5' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url);
      continue;
    }
    if (!res.ok) throw new Error('status ' + res.status);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/')) throw new Error('type');
    return { type, body: await readCapped(res) };
  }
  throw new Error('redirects');
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('x-image-proxy', '1');
  const target = new URL(req.url || '/', 'http://local').searchParams.get('u');
  if (!target) {
    res.statusCode = 400;
    res.end('missing u');
    return;
  }
  try {
    let hit = cache.get(target);
    if (!hit) {
      hit = await fetchImage(target);
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
      cache.set(target, hit);
    }
    res.setHeader('content-type', hit.type);
    res.setHeader('content-length', hit.body.length);
    res.setHeader('cache-control', 'public, max-age=604800');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', 'sandbox');
    res.end(hit.body);
  } catch {
    res.statusCode = 502;
    res.end('unavailable');
  }
}

export function imageProxy(): Plugin {
  // Must return nothing: Vite treats a returned function as a post-middleware hook.
  const attach = (server: { middlewares: { use: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => unknown } }): void => {
    server.middlewares.use('/img', (req, res) => void handle(req, res));
  };
  return { name: 'image-proxy', configureServer: attach, configurePreviewServer: attach };
}
