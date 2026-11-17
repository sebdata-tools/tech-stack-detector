// Tech Stack Detector: one plain HTTP request per website, technologies recognised from headers, cookies and HTML, each with its evidence.
import { Actor, log } from 'apify';
import { ProxyAgent, fetch } from 'undici';

import { InputError, MAX_HTML_BYTES, buildRow, charsetOf, detectBlock, looksLikeHtml, normalizeInput } from './lib.js';

const EVENT = 'site';
const HEADERS = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'upgrade-insecure-requests': '1',
};
const RETRIES = 2;
const TIMEOUT_MS = 25_000; // one attempt: all redirects and the body
const MAX_REDIRECTS = 8;
const SITE_CONCURRENCY = 8;
const PERMANENT_CODES = new Set(['ENOTFOUND', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']);

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const codeOf = (err) => err?.cause?.code ?? err?.code ?? err?.cause?.cause?.code ?? null;

const stats = { sites: 0, sitesRead: 0, sitesBlocked: 0, sitesFailed: 0, requests: 0, rowsCharged: 0 };

/** Reads at most MAX_HTML_BYTES of a response body. */
async function readCapped(res) {
    if (!res.body) return Buffer.alloc(0);
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
        if (total >= MAX_HTML_BYTES) {
            await reader.cancel().catch(() => {});
            break;
        }
    }
    return Buffer.concat(chunks).subarray(0, MAX_HTML_BYTES);
}

function decode(buffer, contentType) {
    const charset = charsetOf(contentType, buffer.subarray(0, 4096).toString('latin1'));
    try {
        return new TextDecoder(charset).decode(buffer);
    } catch {
        return new TextDecoder('utf-8').decode(buffer);
    }
}

/**
 * One attempt at a page: follows redirects by hand (so the cookies set on the way are seen and sent back to the same host)
 * and reads the final response. Returns { finalUrl, status, headers, cookies, html, isHtml }.
 */
async function fetchPage(startUrl, dispatcher) {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const cookieNames = new Set();
    const jar = new Map(); // host -> Map(name -> value)
    let url = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const { host } = new URL(url);
        const cookie = [...(jar.get(host) ?? [])].map(([k, v]) => `${k}=${v}`).join('; ');
        stats.requests++;
        const res = await fetch(url, { dispatcher, redirect: 'manual', headers: cookie ? { ...HEADERS, cookie } : HEADERS, signal });
        for (const line of res.headers.getSetCookie()) {
            const pair = line.split(';', 1)[0];
            const eq = pair.indexOf('=');
            const name = (eq > 0 ? pair.slice(0, eq) : pair).trim();
            if (!name) continue;
            cookieNames.add(name);
            if (!jar.has(host)) jar.set(host, new Map());
            jar.get(host).set(name, eq > 0 ? pair.slice(eq + 1).trim() : '');
        }
        const location = res.headers.get('location');
        if ([301, 302, 303, 307, 308].includes(res.status) && location) {
            await res.body?.cancel().catch(() => {});
            const nextUrl = new URL(location, url);
            if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') throw Object.assign(new Error(`Redirect to a non-web address (${nextUrl.protocol})`), { permanent: true });
            nextUrl.hash = '';
            url = nextUrl.href;
            continue;
        }
        const headers = {};
        for (const [k, v] of res.headers) if (k !== 'set-cookie') headers[k.toLowerCase()] = v;
        const contentType = headers['content-type'] ?? '';
        if (contentType && !looksLikeHtml(contentType, '') && !/^text\/plain|^application\/octet-stream/i.test(contentType)) {
            await res.body?.cancel().catch(() => {});
            return { finalUrl: url, status: res.status, headers, cookies: [...cookieNames], html: '', isHtml: false };
        }
        const html = decode(await readCapped(res), contentType);
        return { finalUrl: url, status: res.status, headers, cookies: [...cookieNames], html, isHtml: looksLikeHtml(contentType, html) };
    }
    throw Object.assign(new Error(`More than ${MAX_REDIRECTS} redirects`), { permanent: true });
}

/** A page with retries and backoff on network errors, 429 and 5xx. A challenge page is returned at once: retrying does not get past it. */
async function request(url, dispatcher, retries = RETRIES) {
    let lastError;
    let lastResponse;
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.random() * 500);
        try {
            const res = await fetchPage(url, dispatcher);
            const block = detectBlock(res);
            const retryable = (res.status === 429 || res.status >= 500) && (!block || block.startsWith('HTTP '));
            if (!retryable) return res;
            lastResponse = res;
        } catch (err) {
            if (err.permanent || PERMANENT_CODES.has(codeOf(err))) throw err;
            lastError = err;
        }
    }
    if (lastResponse) return lastResponse;
    throw lastError;
}

/** Why a site could not be reached, in words a user can act on. */
function explain(err) {
    const code = codeOf(err);
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'The domain does not resolve (DNS lookup failed).';
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || /TIMEOUT/.test(code ?? '')) return `No answer within ${TIMEOUT_MS / 1000} seconds.`;
    if (code === 'ECONNREFUSED') return 'The server refused the connection.';
    if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'The server closed the connection.';
    if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code ?? '')) return `The site's HTTPS certificate is not valid (${code}).`;
    return `Request failed: ${err?.message ?? err}${code ? ` (${code})` : ''}`;
}

await Actor.init();

let input;
try {
    input = normalizeInput(await Actor.getInput());
} catch (err) {
    if (err instanceof InputError) await Actor.fail(`Invalid input: ${err.message}`);
    throw err;
}
stats.sites = input.targets.length;

const proxyConfiguration = input.proxyConfiguration ? await Actor.createProxyConfiguration(input.proxyConfiguration) : undefined;
const proxyUrl = await proxyConfiguration?.newUrl();
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

const chargingManager = Actor.getChargingManager();
const remainingBudget = () => {
    const n = chargingManager.calculateMaxEventChargeCountWithinLimit(EVENT);
    return Number.isFinite(n) ? n : Infinity;
};

let limitReached = false;
let pushing = Promise.resolve(); // pushes run one at a time so the spending limit is checked between them
const report = [];

/** Saves one row. A charged row is saved only while the spending limit pays for it. Returns whether it was saved. */
function pushRow(row, charged) {
    const job = pushing.then(async () => {
        if (!charged) {
            await Actor.pushData(row);
            return true;
        }
        if (limitReached) return false;
        if (remainingBudget() < 1) {
            limitReached = true;
            return false;
        }
        const charge = await Actor.pushData(row, EVENT);
        if (charge?.eventChargeLimitReached) limitReached = true;
        stats.rowsCharged++;
        return true;
    });
    pushing = job.catch(() => {});
    return job;
}

async function scanSite(target) {
    const entry = { input: target.source, url: target.url, status: 'ok', charged: false, technologies: 0 };
    report.push(entry);
    try {
        let res;
        try {
            res = await request(target.url, dispatcher);
        } catch (err) {
            // A bare domain is tried over https first; when https cannot connect (and the name resolves), http gets one try.
            if (!target.fallbackUrl || ['ENOTFOUND', 'EAI_AGAIN'].includes(codeOf(err))) throw err;
            res = await request(target.fallbackUrl, dispatcher, 0).catch(() => { throw err; });
        }
        entry.finalUrl = res.finalUrl;
        entry.statusCode = res.status;
        const block = detectBlock(res);
        const checkedAt = new Date().toISOString();

        if (block) {
            // Only the headers and cookies are the site's own on a challenge page, so only they are read. Saved, not charged.
            const row = buildRow(target, { ...res, html: '' }, { blocked: block, checkedAt });
            await pushRow(row, false);
            Object.assign(entry, { status: 'blocked', technologies: row.technologyCount, message: `${block}: the page itself could not be read. The row holds what the response headers reveal and was not charged. A residential proxy in the input may help.` });
            stats.sitesBlocked++;
            log.warning(`${target.host}: ${block}; ${row.technologyCount} technologies from headers, not charged.`);
        } else if (res.status < 200 || res.status >= 300) {
            Object.assign(entry, { status: 'http_error', message: `The site answered HTTP ${res.status}.` });
            stats.sitesFailed++;
            log.warning(`${target.host}: ${entry.message}`);
        } else if (!res.isHtml) {
            Object.assign(entry, { status: 'not_html', message: `The address did not return an HTML page (content-type: ${res.headers['content-type'] ?? 'none'}).` });
            stats.sitesFailed++;
            log.warning(`${target.host}: ${entry.message}`);
        } else {
            const row = buildRow(target, res, { checkedAt });
            const saved = await pushRow(row, true);
            if (saved) {
                Object.assign(entry, { charged: true, technologies: row.technologyCount });
                stats.sitesRead++;
                log.info(`${target.host}: ${row.technologyCount} technologies.`);
            } else {
                Object.assign(entry, { status: 'skipped', message: 'Not saved: the spending limit for this run was reached.' });
            }
        }
    } catch (err) {
        Object.assign(entry, { status: 'unreachable', message: explain(err) });
        stats.sitesFailed++;
        log.warning(`${target.host}: ${entry.message}`);
    }
    await Actor.setStatusMessage(`${stats.sitesRead + stats.sitesBlocked + stats.sitesFailed}/${stats.sites} websites done, ${stats.rowsCharged} read`);
}

// A fixed number of websites at a time.
let next = 0;
await Promise.all(Array.from({ length: Math.min(SITE_CONCURRENCY, input.targets.length) }, async () => {
    while (next < input.targets.length && !limitReached) await scanSite(input.targets[next++]);
}));
await pushing;
for (const target of input.targets.slice(next)) {
    report.push({ input: target.source, url: target.url, status: 'skipped', charged: false, technologies: 0, message: 'Not checked: the spending limit for this run was reached.' });
}

await Actor.setValue('SUMMARY', { ...stats, limitReached, siteReport: report });

if (limitReached) log.info('The spending limit for this run was reached; stopped early with the results saved so far.');
if (report.length > 0 && report.every((r) => r.status === 'unreachable' || r.status === 'http_error')) {
    await Actor.fail('None of the websites could be reached. Nothing was charged for results. Check the addresses, try again, or set a proxy in the input.');
}
const notes = [
    stats.sitesBlocked ? `${stats.sitesBlocked} blocked (headers only, not charged)` : null,
    stats.sitesFailed ? `${stats.sitesFailed} not read` : null,
    limitReached ? 'spending limit reached' : null,
].filter(Boolean);
await Actor.exit(`Done: ${stats.sitesRead} of ${stats.sites} websites read${notes.length ? ` (${notes.join(', ')})` : ''}. Per-site details are in the SUMMARY record.`);
