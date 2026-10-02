// ════════════════════════════════════════════════════════════════
//  api/_lib/site-reader.js  —  Lecture du texte public d'un site web
//
//  Utilisé par /api/fabrique-site (La Fabrique d'assistants) : l'apprenant
//  donne l'adresse de SON site, on en extrait le texte visible pour que
//  Claude propose des réponses (offres, clients, infos pratiques).
//
//  ⚠️ L'URL vient d'un inconnu : protections anti-SSRF obligatoires.
//    - http(s) uniquement, ports 80/443, pas d'identifiants dans l'URL ;
//    - résolution DNS AVANT chaque requête, refus de toute adresse
//      privée / locale / réservée (IPv4 et IPv6) ;
//    - redirections suivies à la main (3 max), revalidées à chaque saut ;
//    - timeout par requête, corps plafonné, HTML uniquement.
//  Reste une fenêtre théorique de « DNS rebinding » entre notre résolution
//  et celle de fetch : acceptable ici (aucun service interne exposé sur
//  le réseau des fonctions Vercel, réponse jamais renvoyée brute).
// ════════════════════════════════════════════════════════════════

import { lookup } from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 1_500_000;
const PAGE_TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 3;
const MAX_TEXT_PER_PAGE = 9_000;
const MAX_EXTRA_PAGES = 2;
const UA = 'Mozilla/5.0 (compatible; EnekoFabrique/1.0; +https://outils.eneko.ai/fabrique-assistants)';

export class SiteError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ── Adresses interdites ─────────────────────────────────────────
function ipv4Private(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||   // CGNAT
    (a === 169 && b === 254) ||              // link-local (métadonnées cloud)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19));
}
function ipv6Private(ip) {
  const x = ip.toLowerCase();
  if (x === '::' || x === '::1') return true;
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x) || x.startsWith('64:ff9b') || x.startsWith('2001:db8');
}
export function ipInterdite(ip) {
  const v = net.isIP(ip);
  if (v === 4) return ipv4Private(ip);
  if (v === 6) return ipv6Private(ip);
  return true;
}

export function normaliserUrl(input) {
  let s = String(input || '').trim();
  if (!s || s.length > 300) throw new SiteError('url', 'Adresse invalide.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new SiteError('url', 'Adresse invalide.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new SiteError('url', 'Adresse invalide.');
  if (u.username || u.password) throw new SiteError('url', 'Adresse invalide.');
  if (u.port && !['80', '443'].includes(u.port)) throw new SiteError('url', 'Adresse invalide.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) || !host.includes('.') || /(^|\.)(localhost|local|internal|lan|home|corp)$/i.test(host)) {
    throw new SiteError('url', 'Adresse invalide.');
  }
  u.hash = '';
  return u;
}

async function verifierHote(u) {
  let addrs;
  try { addrs = await lookup(u.hostname, { all: true, verbatim: true }); }
  catch { throw new SiteError('dns', 'Ce site est introuvable.'); }
  if (!addrs.length || addrs.some((a) => ipInterdite(a.address))) {
    throw new SiteError('url', 'Adresse invalide.');
  }
}

// ── Récupération d'une page HTML ────────────────────────────────
async function lireCorps(res) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) { await reader.cancel().catch(() => {}); break; }
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const ct = res.headers.get('content-type') || '';
  const cs = (ct.match(/charset=([\w-]+)/i)?.[1] || 'utf-8').toLowerCase();
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

export async function recupererPage(urlObj) {
  let u = urlObj;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await verifierHote(u);
    let res;
    try {
      res = await fetch(u.href, {
        redirect: 'manual',
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-FR,fr;q=0.9' },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
    } catch {
      throw new SiteError('fetch', 'Le site ne répond pas.');
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new SiteError('fetch', 'Le site ne répond pas.');
      u = normaliserUrl(new URL(loc, u).href);
      continue;
    }
    if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new SiteError('http', 'Le site a refusé la lecture.'); }
    const ct = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) { await res.body?.cancel().catch(() => {}); throw new SiteError('type', 'Cette adresse n\'est pas une page web.'); }
    return { url: u, html: await lireCorps(res) };
  }
  throw new SiteError('fetch', 'Trop de redirections.');
}

// ── HTML → texte utile ──────────────────────────────────────────
const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', euro: '€', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—' };
function decoder(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ' '; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ' '; } })
    .replace(/&([a-z]+);/gi, (m, n) => ENTITES[n.toLowerCase()] ?? m);
}
function meta(html, re) { const m = html.match(re); return m ? decoder(m[1]).trim() : ''; }

export function htmlVersTexte(html) {
  const titre = meta(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const desc = meta(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || meta(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
  const corps = html
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br|header|footer|nav)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const lignes = decoder(corps).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 1);
  // Dédoublonnage : menus et pieds de page se répètent.
  const vues = new Set(); const uniques = [];
  for (const l of lignes) { const k = l.toLowerCase(); if (!vues.has(k)) { vues.add(k); uniques.push(l); } }
  const texte = [titre && `Titre : ${titre}`, desc && `Description : ${desc}`, uniques.join('\n')].filter(Boolean).join('\n');
  return texte.slice(0, MAX_TEXT_PER_PAGE);
}

// Pages internes les plus utiles : contact, à propos, services, tarifs, horaires.
const UTILES = /(contact|a-propos|apropos|about|qui-sommes|notre-histoire|services|prestations|offres|tarifs|prix|horaires|infos-pratiques|carte|menu)/i;
export function liensUtiles(html, base) {
  const out = []; const vus = new Set([base.pathname.replace(/\/$/, '')]);
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u; try { u = new URL(m[1], base); } catch { continue; }
    if (u.hostname !== base.hostname || !/^https?:$/.test(u.protocol)) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|zip|docx?)$/i.test(u.pathname)) continue;
    const label = m[2].replace(/<[^>]+>/g, ' ');
    const k = u.pathname.replace(/\/$/, '');
    if (vus.has(k) || !(UTILES.test(u.pathname) || UTILES.test(label.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-')))) continue;
    vus.add(k); u.hash = ''; u.search = '';
    out.push(u);
    if (out.length >= MAX_EXTRA_PAGES) break;
  }
  return out;
}

// Point d'entrée : page d'accueil + 2 pages utiles au plus, en parallèle.
export async function lireSite(input) {
  const u = normaliserUrl(input);
  const accueil = await recupererPage(u);
  const pages = [{ url: accueil.url.href, texte: htmlVersTexte(accueil.html) }];
  const extra = await Promise.allSettled(liensUtiles(accueil.html, accueil.url).map(recupererPage));
  for (const r of extra) if (r.status === 'fulfilled') pages.push({ url: r.value.url.href, texte: htmlVersTexte(r.value.html) });
  if (pages.every((p) => p.texte.length < 80)) throw new SiteError('vide', 'Ce site affiche trop peu de texte lisible.');
  return { url: accueil.url.href, pages };
}
