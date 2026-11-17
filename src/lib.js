// Pure functions: input checks, HTML reading, bot-challenge recognition and technology detection.
// No network and no Apify SDK here, so everything in this file is unit-tested on saved fixtures.
import { CATEGORIES, FINGERPRINTS } from './fingerprints.js';

export const MAX_SITES = 1000;
export const MAX_HTML_BYTES = 2_000_000;

export class InputError extends Error {}

/**
 * Turns one "websites" entry into a target: { source, url, host, fallbackUrl }.
 * Accepts a bare domain ("example.com") or a URL. A bare domain is tried over https first;
 * `fallbackUrl` is the http address to try when https cannot connect.
 */
export function parseWebsite(entry) {
    const raw = String(entry).trim();
    if (!raw) return null;
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
    let url;
    try {
        url = new URL(hasScheme ? raw : `https://${raw}`);
    } catch {
        throw new InputError(`"${raw}" is not a valid website address.`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new InputError(`"${raw}" is not a valid website address (only http and https).`);
    if (!/^[a-z0-9.-]+\.[a-z][a-z0-9-]*[a-z0-9]$/i.test(url.hostname)) throw new InputError(`"${raw}" is not a valid website address.`);
    url.hash = '';
    url.username = '';
    url.password = '';
    const host = url.hostname.toLowerCase();
    return { source: raw, url: url.href, host, fallbackUrl: hasScheme ? null : `http://${url.host}${url.pathname}${url.search}` };
}

/** Validates the raw Actor input and fills defaults. Throws InputError with a message a user can act on. */
export function normalizeInput(raw) {
    const input = raw ?? {};
    let { websites } = input;
    if (typeof websites === 'string') websites = websites.split(/\r?\n/);
    if (!Array.isArray(websites)) {
        throw new InputError('Input field "websites" is required: a list of website addresses, e.g. ["https://www.allbirds.com", "wordpress.org"].');
    }
    const targets = [];
    const seen = new Set();
    for (const entry of websites) {
        const value = entry && typeof entry === 'object' ? entry.url : entry; // also accepts [{ url }] (Apify request list)
        if (typeof value !== 'string') throw new InputError('Every entry of "websites" must be a text string.');
        const target = parseWebsite(value);
        if (!target) continue;
        const key = target.url.replace(/^https?:/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push(target);
    }
    if (targets.length === 0) throw new InputError('Input field "websites" is empty: give at least one website address.');
    if (targets.length > MAX_SITES) throw new InputError(`Too many websites: ${targets.length}. The limit is ${MAX_SITES} per run.`);
    return { targets, proxyConfiguration: input.proxyConfiguration ?? null };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'", '#x2F': '/', '#47': '/' };
const decodeAttr = (s) => s.replace(/&(amp|lt|gt|quot|apos|#39|#x27|#x2F|#47);/gi, (whole, code) => ENTITIES[code] ?? ENTITIES[code.toLowerCase()] ?? whole);

/** Attributes of one tag as a { name: value } map (names lower-cased; value-less attributes map to ''). */
export function parseAttrs(text) {
    const attrs = {};
    const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
        const name = m[1].toLowerCase();
        if (!(name in attrs)) attrs[name] = decodeAttr(m[2] ?? m[3] ?? m[4] ?? '');
    }
    return attrs;
}

const SKIP_LINK_RELS = /\b(?:canonical|alternate|next|prev|shortlink|author|me|license|search|amphtml)\b/i;
const DATA_SCRIPT_TYPES = /^application\/(?:ld\+json|json)$|^text\/(?:template|x-template|html|x-handlebars-template)$/i;

/**
 * Reads what detection needs out of a page's HTML, in one pass and without running anything:
 * meta tags, the URLs of external scripts, stylesheets/link hints and iframes, and the text of inline scripts.
 * Tags inside HTML comments are ignored (commented-out code is not in use).
 */
export function parsePage(html) {
    const metas = [];
    const urls = [];
    const inline = [];
    const re = /<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script\s*>|<(link|meta|iframe)\b([^>]*)>/gi;
    for (let m = re.exec(html); m; m = re.exec(html)) {
        if (m[1] !== undefined) {
            const attrs = parseAttrs(m[1]);
            if (attrs.src) urls.push({ kind: 'script src', url: attrs.src.trim() });
            else if (m[2] && !DATA_SCRIPT_TYPES.test(attrs.type ?? '')) inline.push(m[2]);
        } else if (m[3]) {
            const tag = m[3].toLowerCase();
            const attrs = parseAttrs(m[4]);
            if (tag === 'link') {
                if (attrs.href && !SKIP_LINK_RELS.test(attrs.rel ?? '')) urls.push({ kind: 'link href', url: attrs.href.trim() });
            } else if (tag === 'iframe') {
                const src = attrs.src || attrs['data-src'];
                if (src) urls.push({ kind: 'iframe src', url: src.trim() });
            } else {
                const name = (attrs.name ?? attrs.property ?? attrs['http-equiv'] ?? '').toLowerCase();
                if (name && attrs.content !== undefined) metas.push({ name, content: attrs.content.trim() });
            }
        }
    }
    return { metas, urls, inline: inline.join('\n'), html };
}

const clip = (text, max) => {
    const s = String(text).replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 3)}...` : s;
};
/** A long match keeps its two ends: the telling part of a pattern is usually the first or the last thing it matched. */
const clipMiddle = (text, max) => {
    const s = String(text).replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    const tail = Math.floor((max - 5) / 2);
    return `${s.slice(0, max - 5 - tail)} ... ${s.slice(-tail)}`;
};
/** A URL without its scheme; a long one is cut to a window that contains what matched. */
const showUrl = (url, m) => {
    const MAX = 120;
    const offset = /^(?:https?:)?\/\//i.exec(url)?.[0].length ?? 0;
    const s = url.slice(offset).replace(/\s+/g, ' ');
    if (s.length <= MAX) return s;
    const at = Math.max(0, m.index - offset);
    if (at + m[0].length <= MAX - 3) return `${s.slice(0, MAX - 3)}...`;
    const start = Math.max(0, Math.min(at - 20, s.length - (MAX - 6)));
    const end = start + MAX - 6;
    return `...${s.slice(start, end)}${end < s.length ? '...' : ''}`;
};

/** Tries one rule against a page. Returns { evidence, version } or null. */
function matchRule(rule, page) {
    const hit = (m, evidence) => ({ evidence, version: m?.groups?.v || null });
    switch (rule.type) {
        case 'header': {
            const value = page.headers[rule.key];
            if (value === undefined) return null;
            if (!rule.re) return hit(null, `header ${rule.key}: ${clip(value, 80)}`);
            const m = rule.re.exec(value);
            return m ? hit(m, `header ${rule.key}: ${clip(value, 80)}`) : null;
        }
        case 'cookie':
            for (const name of page.cookies) {
                const m = rule.re.exec(name);
                if (m) return hit(m, `cookie name: ${clip(name, 60)}`);
            }
            return null;
        case 'meta':
            for (const meta of page.metas) {
                if (meta.name !== rule.key) continue;
                const m = rule.re.exec(meta.content);
                if (m) return hit(m, `meta ${rule.key}: ${clip(meta.content, 80)}`);
            }
            return null;
        case 'url':
            for (const { kind, url } of page.urls) {
                const m = rule.re.exec(url);
                if (m) return hit(m, `${kind}: ${showUrl(url, m)}`);
            }
            return null;
        case 'html': {
            const m = rule.re.exec(page.html);
            return m ? hit(m, `html: ${clipMiddle(m[0], 110)}`) : null;
        }
        case 'inline': {
            const m = rule.re.exec(page.inline);
            return m ? hit(m, `inline script: ${clipMiddle(m[0], 110)}`) : null;
        }
        case 'all': {
            // Every part must match; the evidence names each of them.
            const parts = rule.rules.map((r) => matchRule(r, page));
            if (parts.some((p) => !p)) return null;
            return { evidence: parts.map((p) => p.evidence).join(' + '), version: parts.find((p) => p.version)?.version ?? null };
        }
        default:
            return null;
    }
}

/**
 * Detects technologies in one response.
 * `response` = { headers: { lower-case name: value }, cookies: [names], html }.
 * Returns [{ name, category, version, confidence, evidence }]: the evidence is the strongest rule that matched.
 * A technology that another one is built on (Next.js -> React) is added with "implied by ..." evidence.
 */
export function detect(response, fingerprints = FINGERPRINTS) {
    const page = { headers: response.headers ?? {}, cookies: response.cookies ?? [], ...parsePage(response.html ?? '') };
    const found = new Map();
    for (const fp of fingerprints) {
        let best = null;
        let version = null;
        for (const rule of fp.rules) {
            const m = matchRule(rule, page);
            if (!m) continue;
            if (!best || (best.confidence === 'medium' && rule.confidence === 'high')) best = { confidence: rule.confidence, evidence: m.evidence };
            version ??= m.version;
            if (best.confidence === 'high' && version) break;
        }
        if (best) found.set(fp.name, { name: fp.name, category: fp.category, version, confidence: best.confidence, evidence: best.evidence });
    }
    const byName = new Map(fingerprints.map((fp) => [fp.name, fp]));
    const queue = [...found.values()];
    while (queue.length > 0) {
        const tech = queue.shift();
        for (const name of byName.get(tech.name)?.implies ?? []) {
            const target = byName.get(name);
            if (!target) continue;
            const existing = found.get(name);
            // Found already: the implication only matters when it is stronger than a weak direct signal.
            if (existing && !(existing.confidence === 'medium' && tech.confidence === 'high')) continue;
            const source = tech.evidence.startsWith('implied by ') ? tech.evidence : `implied by ${tech.name} (${tech.evidence})`;
            const implied = { name, category: target.category, version: existing?.version ?? null, confidence: tech.confidence, evidence: clip(source, 200) };
            found.set(name, implied);
            queue.push(implied);
        }
    }
    const order = new Map(fingerprints.map((fp, i) => [fp.name, i]));
    return [...found.values()].sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || order.get(a.name) - order.get(b.name));
}

/** Category -> names of the technologies found in it. */
export function summarize(technologies) {
    const categories = {};
    for (const t of technologies) (categories[t.category] ??= []).push(t.name);
    return categories;
}

/**
 * Recognises a bot-challenge or access-denied answer. Returns a reason string, or null when the page is the real one.
 * `response` = { status, headers, html }.
 */
export function detectBlock({ status, headers = {}, html = '' }) {
    const head = html.slice(0, 60_000);
    if (/^challenge$/i.test(headers['cf-mitigated'] ?? '')) return 'Cloudflare challenge page';
    if (/<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(head) && /challenge-platform|cf-chl-|_cf_chl_opt/i.test(html)) return 'Cloudflare challenge page';
    if (status >= 400 && /<title>\s*Attention Required! \| Cloudflare\s*<\/title>/i.test(head)) return 'Cloudflare block page';
    if (/^(?:challenge|captcha)$/i.test(headers['x-amzn-waf-action'] ?? '')) return 'AWS WAF challenge page';
    if (/\bcaptcha-delivery\.com\b/i.test(head) && html.length < 20_000) return 'DataDome challenge page';
    if (/<title>\s*Client Challenge\s*<\/title>/i.test(head) && /\/_fs-ch-[A-Za-z0-9]+\//.test(head)) return 'Fastly client challenge page';
    if (/\b_pxAppId\s*=|id="px-captcha"|\/captcha\/captcha\.js\?a=c&/i.test(head) && html.length < 30_000) return 'HUMAN (PerimeterX) challenge page';
    if (/_Incapsula_Resource\?/i.test(head) && html.length < 8_000) return 'Imperva challenge page';
    if (status >= 400 && /<title>\s*Access Denied\s*<\/title>/i.test(head) && /errors\.edgesuite\.net|Reference&#32;&#35;/i.test(head)) return 'Akamai access-denied page';
    if (status === 202) return 'JavaScript challenge page (HTTP 202)'; // a homepage is never "accepted for later": this is how AWS WAF and others answer a challenge
    if (status === 401 || status === 403 || status === 429) return `HTTP ${status} (access refused)`;
    return null;
}

/** True when a response body should be read as an HTML page. */
export function looksLikeHtml(contentType, bodyStart) {
    const type = String(contentType ?? '').toLowerCase();
    if (/html/.test(type)) return true; // text/html, application/xhtml+xml
    if (type && !/^text\/plain|^application\/octet-stream/.test(type)) return false;
    return /^\s*(?:<!doctype html|<html[\s>])/i.test(String(bodyStart ?? '').slice(0, 2000));
}

/** The character set to decode a page with: the content-type header first, then a <meta> in the first bytes. */
export function charsetOf(contentType, firstBytesLatin1) {
    const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(String(contentType ?? ''));
    if (fromHeader) return fromHeader[1].toLowerCase();
    const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(String(firstBytesLatin1 ?? ''));
    return fromMeta ? fromMeta[1].toLowerCase() : 'utf-8';
}

/** The dataset row for one website. `response` = { finalUrl, status, headers, cookies, html }. */
export function buildRow(target, response, { blocked = null, checkedAt } = {}) {
    const technologies = detect(response);
    return {
        website: target.source,
        finalUrl: response.finalUrl,
        statusCode: response.status,
        blocked: Boolean(blocked),
        ...(blocked ? { blockedReason: blocked } : {}),
        technologyCount: technologies.length,
        technologies,
        categories: summarize(technologies),
        checkedAt,
    };
}
