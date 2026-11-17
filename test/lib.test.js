// Unit tests on saved homepages and response headers in test/fixtures/ (captured 2026-11-14, pages trimmed to 200 KB). No network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { CATEGORIES, FINGERPRINTS } from '../src/fingerprints.js';
import { InputError, buildRow, charsetOf, detect, detectBlock, looksLikeHtml, normalizeInput, parseAttrs, parsePage, parseWebsite, summarize } from '../src/lib.js';

const dir = new URL('./fixtures/', import.meta.url);
/** A saved response: { finalUrl, status, headers, cookies, html }. */
const fixture = (name) => ({ ...JSON.parse(fs.readFileSync(new URL(`${name}.headers.json`, dir), 'utf8')), html: fs.readFileSync(new URL(`${name}.html`, dir), 'utf8') });
const names = (techs) => techs.map((t) => t.name);
const stack = (name) => detect(fixture(name));
const tech = (techs, name) => techs.find((t) => t.name === name);
const has = (techs, ...wanted) => { for (const w of wanted) assert.ok(names(techs).includes(w), `expected ${w} in [${names(techs).join(', ')}]`); };
const lacks = (techs, ...unwanted) => { for (const u of unwanted) assert.ok(!names(techs).includes(u), `did not expect ${u} in [${names(techs).join(', ')}]`); };
const BIG_PLATFORMS = ['WordPress', 'Drupal', 'Joomla', 'Ghost', 'Shopify', 'Magento', 'WooCommerce', 'PrestaShop', 'Wix', 'Squarespace', 'Webflow', 'React', 'Next.js', 'Vue.js', 'Nuxt', 'Angular', 'Svelte', 'jQuery', 'PHP'];

// ---------------------------------------------------------------- the fingerprint table

test('fingerprints: every entry is well-formed', () => {
    const seen = new Set();
    const all = new Set(FINGERPRINTS.map((fp) => fp.name));
    const checkRule = (fp, rule) => {
        assert.ok(['high', 'medium'].includes(rule.confidence), `${fp.name}: confidence`);
        if (rule.type === 'all') {
            assert.ok(Array.isArray(rule.rules) && rule.rules.length >= 2, `${fp.name}: "all" needs two rules`);
            for (const r of rule.rules) checkRule(fp, r);
            return;
        }
        assert.ok(['header', 'cookie', 'meta', 'url', 'html', 'inline'].includes(rule.type), `${fp.name}: rule type ${rule.type}`);
        if (rule.type === 'header' || rule.type === 'meta') assert.match(rule.key, /^[a-z0-9:_-]+$/, `${fp.name}: ${rule.type} name must be lower-case`);
        if (rule.type !== 'header' || rule.re !== undefined) {
            assert.ok(rule.re instanceof RegExp, `${fp.name}: ${rule.type} rule needs a regex`);
            assert.ok(!rule.re.global && !rule.re.sticky, `${fp.name}: a g/y regex keeps state between pages`);
            assert.ok(!rule.re.test(''), `${fp.name}: ${rule.re} matches the empty string`);
            new RegExp(rule.re.source, rule.re.flags); // compiles
        }
    };
    for (const fp of FINGERPRINTS) {
        assert.ok(typeof fp.name === 'string' && fp.name.trim() === fp.name && fp.name.length > 1, `name: ${JSON.stringify(fp.name)}`);
        assert.ok(!seen.has(fp.name.toLowerCase()), `duplicate name: ${fp.name}`);
        seen.add(fp.name.toLowerCase());
        assert.ok(CATEGORIES.includes(fp.category), `${fp.name}: unknown category ${fp.category}`);
        assert.ok(Array.isArray(fp.rules) && fp.rules.length > 0, `${fp.name}: no rules`);
        for (const rule of fp.rules) checkRule(fp, rule);
        for (const implied of fp.implies) assert.ok(all.has(implied) && implied !== fp.name, `${fp.name}: implies unknown "${implied}"`);
    }
    assert.ok(FINGERPRINTS.length >= 150, `only ${FINGERPRINTS.length} technologies`);
    for (const category of CATEGORIES) assert.ok(FINGERPRINTS.some((fp) => fp.category === category), `empty category ${category}`);
});

test('fingerprints: nothing matches an empty page, and nothing matches plain prose about the technologies', () => {
    assert.deepEqual(detect({ headers: {}, cookies: [], html: '' }), []);
    const prose = `<html><head><title>Our stack</title></head><body><p>We compared WordPress, Shopify, Wix, Squarespace, Webflow, Drupal, Magento,
        React, Next.js, Vue, Nuxt, Angular, jQuery, Bootstrap, Tailwind, Cloudflare, nginx, Stripe, HubSpot, Intercom, Google Analytics and Sentry.
        Install the plugin under wp-content/plugins, then call gtag and fbq.</p></body></html>`;
    assert.deepEqual(names(detect({ headers: { 'content-type': 'text/html' }, cookies: [], html: prose })), []);
});

// ---------------------------------------------------------------- input

test('parseWebsite: bare domains, URLs, bad entries', () => {
    assert.deepEqual(parseWebsite(' Example.com '), { source: 'Example.com', url: 'https://example.com/', host: 'example.com', fallbackUrl: 'http://example.com/' });
    assert.deepEqual(parseWebsite('http://example.com/shop?a=1#top'), { source: 'http://example.com/shop?a=1#top', url: 'http://example.com/shop?a=1', host: 'example.com', fallbackUrl: null });
    assert.equal(parseWebsite('https://user:pw@www.example.co.uk').url, 'https://www.example.co.uk/');
    assert.equal(parseWebsite(''), null);
    for (const bad of ['not a url', 'localhost', 'ftp://example.com', 'https://', 'exa mple.com']) assert.throws(() => parseWebsite(bad), InputError, bad);
});

test('normalizeInput: duplicates removed, request-list objects accepted, bad input rejected', () => {
    const input = normalizeInput({ websites: ['example.com', 'https://example.com/', 'http://example.com', '', { url: 'https://wordpress.org' }, 'example.com/pricing'] });
    assert.deepEqual(input.targets.map((t) => t.url), ['https://example.com/', 'https://wordpress.org/', 'https://example.com/pricing']);
    assert.equal(input.proxyConfiguration, null);
    assert.equal(normalizeInput({ websites: 'a.com\nb.com' }).targets.length, 2);
    assert.deepEqual(normalizeInput({ websites: ['a.com'], proxyConfiguration: { useApifyProxy: true } }).proxyConfiguration, { useApifyProxy: true });
    for (const bad of [null, {}, { websites: [] }, { websites: [''] }, { websites: [3] }, { websites: ['bad url here'] }, { websites: Array.from({ length: 1001 }, (_, i) => `site${i}.com`) }]) {
        assert.throws(() => normalizeInput(bad), InputError, JSON.stringify(bad)?.slice(0, 60));
    }
});

// ---------------------------------------------------------------- reading a page

test('parseAttrs and parsePage: scripts, links, iframes, metas, inline code; comments and data blocks ignored', () => {
    assert.deepEqual(parseAttrs(` SRC="a.js?x=1&amp;y=2" async data-x='1' defer=defer`), { src: 'a.js?x=1&y=2', async: '', 'data-x': '1', defer: 'defer' });
    const page = parsePage(`<html><head>
        <meta name="Generator" content="Thing 1.2"><meta property="og:type" content="website">
        <link rel="stylesheet" href="/a.css"><link rel="canonical" href="https://cdn.shopify.com/"><link rel=preconnect href=https://fonts.gstatic.com>
        <!-- <script src="https://commented.example/old.js"></script> -->
        <script src="https://live.example/app.js"></script>
        <script>var inlineCode = 1;</script>
        <script type="application/ld+json">{"name":"fbq('init','1234567890')"}</script>
        </head><body><iframe src="https://www.youtube.com/embed/x"></iframe></body></html>`);
    assert.deepEqual(page.metas, [{ name: 'generator', content: 'Thing 1.2' }, { name: 'og:type', content: 'website' }]);
    assert.deepEqual(page.urls, [
        { kind: 'link href', url: '/a.css' },
        { kind: 'link href', url: 'https://fonts.gstatic.com' },
        { kind: 'script src', url: 'https://live.example/app.js' },
        { kind: 'iframe src', url: 'https://www.youtube.com/embed/x' },
    ]);
    assert.equal(page.inline.trim(), 'var inlineCode = 1;');
});

test('looksLikeHtml and charsetOf', () => {
    assert.equal(looksLikeHtml('text/html; charset=utf-8', ''), true);
    assert.equal(looksLikeHtml('application/xhtml+xml', ''), true);
    assert.equal(looksLikeHtml('image/png', '<html>'), false);
    assert.equal(looksLikeHtml('application/json', '{"a":1}'), false);
    assert.equal(looksLikeHtml('', '  <!DOCTYPE html><html>'), true);
    assert.equal(looksLikeHtml('text/plain', 'hello'), false);
    assert.equal(charsetOf('text/html; charset=ISO-8859-1', ''), 'iso-8859-1');
    assert.equal(charsetOf('text/html', '<meta charset="windows-1252">'), 'windows-1252');
    assert.equal(charsetOf('text/html', '<meta http-equiv="Content-Type" content="text/html; charset=shift_jis">'), 'shift_jis');
    assert.equal(charsetOf('text/html', '<html>'), 'utf-8');
});

// ---------------------------------------------------------------- detection on real pages

test('every detection on every fixture carries a name, a known category, a confidence and evidence', () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5));
    assert.ok(files.length >= 20);
    for (const name of files) {
        for (const t of stack(name)) {
            assert.ok(CATEGORIES.includes(t.category), `${name}: ${t.name} category`);
            assert.ok(['high', 'medium'].includes(t.confidence), `${name}: ${t.name} confidence`);
            assert.match(t.evidence, /^(?:header [a-z0-9-]+: |cookie name: |meta [a-z0-9:_-]+: |script src: |link href: |iframe src: |html: |inline script: |implied by )\S/, `${name}: ${t.name} evidence "${t.evidence}"`);
            assert.ok(t.evidence.length <= 260, `${name}: ${t.name} evidence too long`);
            assert.ok(t.version === null || /^\d[\w.-]*$/.test(t.version), `${name}: ${t.name} version "${t.version}"`);
        }
    }
});

test('WordPress (techcrunch.com): generator version, plugins, host, implied PHP', () => {
    const t = stack('wordpress_techcrunch');
    has(t, 'WordPress', 'Yoast SEO', 'WordPress Block Editor', 'PHP', 'WordPress VIP', 'Cloudflare', 'Google Tag Manager');
    assert.match(tech(t, 'WordPress').version, /^\d+\.\d+/);
    assert.match(tech(t, 'WordPress').evidence, /^meta generator: WordPress \d/);
    assert.match(tech(t, 'Yoast SEO').version, /^\d+\.\d+/);
    assert.match(tech(t, 'PHP').evidence, /^implied by WordPress \(meta generator: WordPress/);
    assert.equal(tech(t, 'WordPress VIP').evidence, 'header x-powered-by: WordPress VIP <https://wpvip.com>');
    lacks(t, 'Shopify', 'Drupal', 'Wix', 'Squarespace', 'Magento', 'Joomla', 'Next.js');
});

test('WooCommerce (woocommerce.com): shop plugin, jQuery version from the URL', () => {
    const t = stack('woocommerce_com');
    has(t, 'WordPress', 'WooCommerce', 'jQuery', 'nginx', 'PHP');
    assert.match(tech(t, 'WooCommerce').evidence, /^meta generator: WooCommerce/);
    assert.match(tech(t, 'jQuery').version, /^\d+\.\d+\.\d+$/);
    assert.match(tech(t, 'jQuery').evidence, /^script src: .*\/jquery\/jquery\.min\.js/);
    lacks(t, 'Shopify', 'Magento', 'PrestaShop');
});

test('Shopify (allbirds.com): header evidence, Shop Pay, no other shop platform', () => {
    const t = stack('shopify_allbirds');
    has(t, 'Shopify', 'Shop Pay', 'Cloudflare', 'Google Tag Manager');
    assert.equal(tech(t, 'Shopify').evidence, 'header powered-by: Shopify');
    assert.equal(tech(t, 'Shopify').confidence, 'high');
    assert.match(tech(t, 'Shop Pay').evidence, /^script src: cdn\.shopify\.com\/shopifycloud\/shop-js\//);
    lacks(t, 'WordPress', 'WooCommerce', 'Magento', 'BigCommerce', 'PrestaShop', 'Wix', 'Squarespace', 'PHP');
});

test('Magento (grahamandgreen.co.uk) and PrestaShop (pylones.com)', () => {
    const m = stack('magento_grahamandgreen');
    has(m, 'Magento', 'PHP', 'Fastly', 'Google Tag Manager', 'Meta Pixel', 'New Relic');
    assert.match(tech(m, 'Magento').evidence, /^(?:html: <script type="text\/x-magento-init"|link href: www\.grahamandgreen\.co\.uk\/static\/version\d+\/frontend\/)/);
    assert.equal(tech(m, 'Magento').confidence, 'high');
    lacks(m, 'Shopify', 'WooCommerce', 'WordPress', 'PrestaShop');
    const p = stack('prestashop_pylones');
    has(p, 'PrestaShop', 'PHP', 'Cloudflare', 'Crisp', 'Google Tag Manager');
    assert.match(tech(p, 'PrestaShop').evidence, /^cookie name: PrestaShop-[a-f0-9]{32}$/);
    lacks(p, 'Shopify', 'Magento', 'WooCommerce', 'WordPress');
});

test('site builders: Wix, Squarespace, Webflow each found alone', () => {
    const wix = stack('wix_womeninai');
    has(wix, 'Wix');
    assert.match(tech(wix, 'Wix').evidence, /^header x-wix-request-id: /);
    lacks(wix, 'Squarespace', 'Webflow', 'WordPress', 'Shopify');
    const sq = stack('squarespace_benevans');
    has(sq, 'Squarespace', 'Adobe Fonts');
    assert.equal(tech(sq, 'Squarespace').evidence, 'header server: Squarespace');
    lacks(sq, 'Wix', 'Webflow', 'WordPress', 'Shopify');
    const wf = stack('webflow_rubiks');
    has(wf, 'Webflow', 'GSAP', 'jsDelivr', 'Google Tag Manager');
    assert.match(tech(wf, 'Webflow').evidence, /^html: data-wf-(?:site|page)="[a-f0-9]{24}"$/);
    assert.match(tech(wf, 'GSAP').version, /^\d+\.\d+\.\d+$/);
    lacks(wf, 'Wix', 'Squarespace', 'WordPress', 'Shopify');
});

test('CMS: Drupal, Ghost, Joomla', () => {
    const d = stack('drupal_london');
    has(d, 'Drupal', 'PHP', 'Varnish', 'Cloudflare', 'Google Tag Manager');
    assert.match(tech(d, 'Drupal').evidence, /^(?:header x-drupal-|header x-generator: Drupal|meta generator: Drupal)/);
    lacks(d, 'WordPress', 'Joomla', 'Ghost');
    const g = stack('ghost_404media');
    has(g, 'Ghost', 'Node.js', 'Fastly', 'Stripe');
    assert.match(tech(g, 'Ghost').version, /^\d+\.\d+/);
    lacks(g, 'WordPress', 'Drupal', 'PHP');
    const j = stack('joomla_org');
    has(j, 'Joomla', 'PHP', 'Cloudflare', 'YouTube');
    assert.match(tech(j, 'YouTube').evidence, /^iframe src: www\.youtube(?:-nocookie)?\.com\/embed\//);
    lacks(j, 'WordPress', 'Drupal');
});

test('JavaScript frameworks: Next.js implies React, Nuxt implies Vue.js, Angular version, SvelteKit', () => {
    const next = stack('nextjs_reactdev');
    has(next, 'Next.js', 'React', 'Vercel');
    assert.match(tech(next, 'React').evidence, /^implied by Next\.js \(/);
    assert.equal(tech(next, 'React').confidence, 'high');
    lacks(next, 'Vue.js', 'Nuxt', 'Angular', 'Svelte', 'WordPress');
    const nuxt = stack('nuxt_com');
    has(nuxt, 'Nuxt', 'Vue.js', 'Vercel');
    assert.equal(tech(nuxt, 'Vue.js').confidence, 'high');
    lacks(nuxt, 'React', 'Next.js', 'Angular', 'Svelte');
    const ng = stack('angular_dev');
    has(ng, 'Angular', 'Google Fonts');
    assert.match(tech(ng, 'Angular').version, /^\d+\.\d+\.\d+$/);
    assert.match(tech(ng, 'Angular').evidence, /^html: ng-version="/);
    lacks(ng, 'AngularJS', 'React', 'Vue.js');
    const sk = stack('sveltekit_svelte');
    has(sk, 'SvelteKit', 'Svelte', 'Vercel');
    lacks(sk, 'React', 'Vue.js', 'Angular');
});

test('Ruby on Rails (gov.uk) from the csrf meta tag, with Ruby implied', () => {
    const t = stack('rails_govuk');
    has(t, 'Ruby on Rails', 'Ruby', 'nginx', 'Fastly');
    lacks(t, 'PHP', 'WordPress', 'Django', 'Laravel');
});

test('negative: plain sites show only what their headers reveal', () => {
    assert.deepEqual(names(stack('plain_example')), ['Cloudflare']);
    assert.deepEqual(names(stack('plain_hn')), ['nginx']);
    assert.deepEqual(names(stack('plain_cern')), ['Apache HTTP Server']);
    // A hand-written static page behind Cloudflare: no CMS, no framework, no library.
    const cb = stack('plain_crunchbase');
    assert.deepEqual(names(cb).sort(), ['Cloudflare', 'Cloudflare Bot Management']);
    for (const name of ['plain_example', 'plain_hn', 'plain_cern', 'plain_crunchbase']) lacks(stack(name), ...BIG_PLATFORMS);
});

test('negative: look-alikes found on real pages are not reported', () => {
    // tumblr.com loads a script from s0.wp.com/wp-content/: that is Automattic's CDN, not a WordPress site.
    const tumblr = stack('tumblr_com');
    has(tumblr, 'Tumblr');
    lacks(tumblr, 'WordPress', 'PHP');
    // github.com answers "server: github.com": that is not GitHub Pages.
    lacks(stack('github_com'), 'GitHub Pages', 'WordPress', 'Shopify');
    const pages = detect({ headers: { server: 'GitHub.com', 'x-fastly-request-id': 'abc', 'x-github-request-id': '1:2' }, cookies: [], html: '<html></html>' });
    has(pages, 'GitHub Pages', 'Fastly');
    assert.equal(tech(pages, 'GitHub Pages').evidence, 'header server: GitHub.com + header x-fastly-request-id: abc');
});

test('negative: synthetic traps', () => {
    const page = (html, headers = {}, cookies = []) => detect({ headers, cookies, html });
    // an image hot-linked from somebody else's WordPress or Shopify
    lacks(page('<img src="https://other.example/wp-content/uploads/2024/a.jpg">'), 'WordPress');
    assert.equal(tech(page('<img src="https://cdn.shopify.com/s/files/1/2/a.jpg">'), 'Shopify').confidence, 'medium');
    has(page('<img src="/wp-content/uploads/2024/a.jpg">'), 'WordPress');
    // a commented-out tag, and code quoted inside a JSON data block
    lacks(page('<!-- <script src="https://js.stripe.com/v3/"></script> -->'), 'Stripe');
    lacks(page(`<script type="application/ld+json">{"text":"fbq('init', '1234567890123')"}</script>`), 'Meta Pixel');
    // file names that only resemble a library
    lacks(page('<script src="/js/jquery.cookie.js"></script><script src="/js/my-react-app.js"></script><script src="/js/bootstrap-datepicker.js"></script>'), 'jQuery', 'React', 'Bootstrap');
    has(page('<script src="/js/jquery-3.6.0.min.js"></script>'), 'jQuery');
    assert.equal(tech(page('<script src="/js/jquery-3.6.0.min.js"></script>'), 'jQuery').version, '3.6.0');
    // Apache Tomcat is not Apache HTTP Server
    const tomcat = page('', { server: 'Apache-Coyote/1.1' });
    has(tomcat, 'Apache Tomcat', 'Java');
    lacks(tomcat, 'Apache HTTP Server');
    // a canonical link pointing at another platform
    lacks(page('<link rel="canonical" href="https://js.stripe.com/v3/"><link rel="alternate" hreflang="de" href="https://static.parastorage.com/x">'), 'Stripe', 'Wix');
});

test('evidence formats and versions from each kind of signal', () => {
    const t = detect({
        headers: { server: 'nginx/1.25.3', 'x-powered-by': 'PHP/8.2.12', 'cf-ray': '8a1b2c3d4e5f-AMS' },
        cookies: ['_ga', 'laravel_session'],
        html: `<html><head><meta name="generator" content="WordPress 6.5.2">
            <script src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ"></script>
            <script>fbq('init', '123456789012345');</script>
            <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css"></head></html>`,
    });
    const ev = Object.fromEntries(t.map((x) => [x.name, x]));
    assert.equal(ev.nginx.evidence, 'header server: nginx/1.25.3');
    assert.equal(ev.nginx.version, '1.25.3');
    assert.equal(ev.PHP.evidence, 'header x-powered-by: PHP/8.2.12');
    assert.equal(ev.PHP.version, '8.2.12');
    assert.equal(ev.WordPress.evidence, 'meta generator: WordPress 6.5.2');
    assert.equal(ev.WordPress.version, '6.5.2');
    assert.equal(ev.Laravel.evidence, 'cookie name: laravel_session');
    assert.equal(ev['Google Analytics'].evidence, 'script src: www.googletagmanager.com/gtag/js?id=G-ABC123XYZ');
    assert.equal(ev['Google Analytics'].confidence, 'high');
    assert.equal(ev['Meta Pixel'].evidence, `inline script: fbq('init', '123456789012345'`);
    assert.equal(ev.Bootstrap.evidence, 'link href: cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css');
    assert.equal(ev.Bootstrap.version, '5.3.2');
    assert.equal(ev.Cloudflare.evidence, 'header cf-ray: 8a1b2c3d4e5f-AMS');
    // a weak signal alone is reported as medium
    const weak = detect({ headers: {}, cookies: ['_ga'], html: '' });
    assert.deepEqual(weak.map((x) => [x.name, x.confidence, x.evidence]), [['Google Analytics', 'medium', 'cookie name: _ga']]);
    // a long URL is cut to a window that still shows what matched
    const long = detect({ headers: {}, cookies: [], html: `<script src="https://x.example/${'a'.repeat(300)}/wp-includes/js/jquery/ui/core.min.js?ver=1"></script>` });
    assert.match(tech(long, 'jQuery UI').evidence, /^script src: \.\.\.a+\/wp-includes\/js\/jquery\/ui\/core\.min\.js\?ver=1$/);
});

// ---------------------------------------------------------------- bot challenges

test('detectBlock: challenge pages are recognised, real pages are not', () => {
    assert.equal(detectBlock(fixture('block_cloudflare')), 'Cloudflare challenge page');
    assert.equal(detectBlock(fixture('block_datadome')), 'DataDome challenge page');
    assert.equal(detectBlock(fixture('block_fastly')), 'Fastly client challenge page'); // answered with HTTP 200
    assert.equal(detectBlock(fixture('block_http202')), 'JavaScript challenge page (HTTP 202)');
    assert.equal(detectBlock({ status: 403, headers: {}, html: '<html>Forbidden</html>' }), 'HTTP 403 (access refused)');
    assert.equal(detectBlock({ status: 429, headers: {}, html: '' }), 'HTTP 429 (access refused)');
    assert.equal(detectBlock({ status: 503, headers: {}, html: '<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>' }), 'Cloudflare challenge page');
    assert.equal(detectBlock({ status: 503, headers: {}, html: '<h1>Service Unavailable</h1>' }), null);
    assert.equal(detectBlock({ status: 404, headers: {}, html: '<h1>Not found</h1>' }), null);
    for (const name of ['wordpress_techcrunch', 'shopify_allbirds', 'plain_example', 'plain_crunchbase', 'wix_womeninai', 'drupal_london']) assert.equal(detectBlock(fixture(name)), null, name);
});

// ---------------------------------------------------------------- the dataset row

test('buildRow: a read site, and a blocked site that reports only what its headers show', () => {
    const target = parseWebsite('allbirds.com');
    const row = buildRow(target, fixture('shopify_allbirds'), { checkedAt: '2026-11-14T00:00:00.000Z' });
    assert.deepEqual(Object.keys(row), ['website', 'finalUrl', 'statusCode', 'blocked', 'technologyCount', 'technologies', 'categories', 'checkedAt']);
    assert.equal(row.website, 'allbirds.com');
    assert.equal(row.finalUrl, 'https://www.allbirds.com/');
    assert.equal(row.statusCode, 200);
    assert.equal(row.blocked, false);
    assert.equal(row.technologyCount, row.technologies.length);
    assert.deepEqual(Object.keys(row.technologies[0]), ['name', 'category', 'version', 'confidence', 'evidence']);
    assert.deepEqual(row.categories.Ecommerce, ['Shopify']);
    assert.deepEqual(row.categories, summarize(row.technologies));
    assert.equal(Object.values(row.categories).flat().length, row.technologyCount);

    const blockedFixture = fixture('block_cloudflare');
    const reason = detectBlock(blockedFixture);
    const blocked = buildRow(parseWebsite('https://www.opencart.com'), { ...blockedFixture, html: '' }, { blocked: reason, checkedAt: '2026-11-14T00:00:00.000Z' });
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.blockedReason, 'Cloudflare challenge page');
    assert.equal(blocked.statusCode, 403);
    assert.deepEqual(names(blocked.technologies), ['Cloudflare', 'Cloudflare Bot Management']);
    assert.ok(blocked.technologies.every((t) => /^(?:header|cookie name)/.test(t.evidence)));
});
