# Website Tech Stack Detector: Technologies with Evidence

Give Website Tech Stack Detector a list of websites and get back **the technologies each one runs on, with the evidence for
every detection**: the exact header, script URL, cookie name or tag that gave it away. One row per
website: CMS, shop platform, site builder, JavaScript frameworks, CDN, hosting, analytics, ad
pixels, chat widgets, payment, consent manager and more.

- **Evidence on every detection:** `header server: cloudflare`, `meta generator: WordPress 6.5`,
  `script src: cdn.shopify.com/...`, `cookie name: PrestaShop-...`. You can check each result
  yourself instead of trusting a label.
- **483 technologies in 29 categories**, each matched by a host name or a marker only that
  technology produces. Weaker signals are marked `medium`, the rest `high`.
- **Versions** when the page shows one (`WordPress 6.9.11`, `Angular 22.2.6`, `jQuery 3.7.1`).
- **Fast:** one plain HTTP request per website, 8 websites at a time, no browser. In our tests 20
  websites took 2.5 seconds.
- **Up to 1,000 websites per run.**

Open source (MIT). Written in Node.js on the Apify SDK; it runs on your own machine without an Apify account.

## Run it locally

Needs Node.js 20 or later.

```
git clone https://github.com/sebdata-tools/tech-stack-detector.git
cd tech-stack-detector
npm install
node test/run_local.mjs @input.json
```

`input.json` is a file you write; the fields are under "Input example" below. `run_local.mjs` runs
`src/main.js` with local storage, prints a summary and the first rows, and leaves all rows in
`storage/items.json` (one file per row is in `storage/datasets/default/`). Each run wipes `storage/` first.

Where the sections below mention a price or what is charged, that applies to the hosted version only:
run locally, nothing is charged.

## Input example

```json
{
    "websites": ["https://www.deathwishcoffee.com", "wordpress.org", "https://www.opencart.com"]
}
```

| Field | What it does | Default |
|---|---|---|
| `websites` | Domains or addresses, up to 1,000. The homepage is checked unless you give a longer address. Required. | |
| `proxyConfiguration` | Optional proxy. Usually not needed; some websites that block datacenter addresses answer through a proxy. | none |

## Output example

A real row from the input above:

```json
{
    "website": "https://www.deathwishcoffee.com",
    "finalUrl": "https://www.deathwishcoffee.com/",
    "statusCode": 200,
    "blocked": false,
    "technologyCount": 5,
    "technologies": [
        { "name": "Shopify", "category": "Ecommerce", "version": null, "confidence": "high", "evidence": "header powered-by: Shopify" },
        { "name": "Cloudflare", "category": "CDN", "version": null, "confidence": "high", "evidence": "header cf-ray: a5a45d80fd8ba4c4-MIA" },
        { "name": "Google Tag Manager", "category": "Tag manager", "version": null, "confidence": "high", "evidence": "iframe src: www.googletagmanager.com/ns.html?id=GTM-WS7HLL9" },
        { "name": "Klaviyo", "category": "Marketing automation", "version": null, "confidence": "high", "evidence": "script src: static.klaviyo.com/onsite/js/Q6RhjR/klaviyo.js?company_id=Q6RhjR" },
        { "name": "Shop Pay", "category": "Payment", "version": null, "confidence": "high", "evidence": "script src: cdn.shopify.com/shopifycloud/shop-js/modules/v2/loader.init-shop-cart-sync.en.esm.js" }
    ],
    "categories": {
        "Ecommerce": ["Shopify"],
        "CDN": ["Cloudflare"],
        "Tag manager": ["Google Tag Manager"],
        "Marketing automation": ["Klaviyo"],
        "Payment": ["Shop Pay"]
    },
    "checkedAt": "2026-11-14T07:39:18.018Z"
}
```

A version, and a technology that follows from another one (WordPress runs on PHP), look like this:

```json
{ "name": "WordPress", "category": "CMS", "version": "7.2", "confidence": "high", "evidence": "meta generator: WordPress 7.2-beta5-65523" },
{ "name": "PHP", "category": "Programming language", "version": null, "confidence": "high", "evidence": "implied by WordPress (meta generator: WordPress 7.2-beta5-65523)" }
```

A website that answers with a bot challenge is still listed, flagged, with what its response
headers reveal, and **is not charged**:

```json
{
    "website": "https://www.opencart.com",
    "finalUrl": "https://www.opencart.com/",
    "statusCode": 403,
    "blocked": true,
    "blockedReason": "Cloudflare challenge page",
    "technologyCount": 2,
    "technologies": [
        { "name": "Cloudflare", "category": "CDN", "version": null, "confidence": "high", "evidence": "header cf-ray: a5a45d81095a55ca-MIA" },
        { "name": "Cloudflare Bot Management", "category": "Security", "version": null, "confidence": "high", "evidence": "header cf-mitigated: challenge" }
    ],
    "categories": { "CDN": ["Cloudflare"], "Security": ["Cloudflare Bot Management"] },
    "checkedAt": "2026-11-14T07:39:17.651Z"
}
```

Export the dataset as JSON, CSV or Excel, or read it through the Apify API.

## What it covers

483 technologies in 29 categories:

| Category | Count | Examples |
|---|---|---|
| CMS | 28 | WordPress, Drupal, Joomla, Ghost, TYPO3, HubSpot CMS, Contentful, Sanity, Adobe Experience Manager |
| Ecommerce | 18 | Shopify, WooCommerce, Magento, BigCommerce, PrestaShop, Salesforce Commerce Cloud, Shopware |
| Site builder | 18 | Wix, Squarespace, Webflow, Framer, Weebly, Duda, Tilda |
| Static site generator | 11 | Hugo, Jekyll, Gatsby, Astro, Docusaurus, VitePress |
| WordPress plugin or theme | 21 | Yoast SEO, Elementor, Jetpack, Rank Math, WP Rocket, Divi |
| JavaScript framework | 23 | React, Next.js, Vue.js, Nuxt, Angular, Svelte, SvelteKit, Alpine.js, htmx |
| JavaScript library | 35 | jQuery, GSAP, Swiper, Lodash, D3, Three.js |
| UI framework | 15 | Bootstrap, Tailwind CSS, MUI, Chakra UI, styled-components |
| Web server | 20 | nginx, Apache, IIS, LiteSpeed, Envoy, Varnish |
| Programming language | 5 | PHP, Java, Python, Ruby, Node.js |
| Web framework | 13 | ASP.NET, Ruby on Rails, Laravel, Django, Express |
| CDN | 14 | Cloudflare, Amazon CloudFront, Fastly, Akamai, jsDelivr |
| Hosting | 25 | Vercel, Netlify, GitHub Pages, WP Engine, WordPress VIP, Heroku, Google Cloud |
| Analytics | 31 | Google Analytics, Hotjar, Microsoft Clarity, Plausible, Segment, Mixpanel |
| Tag manager | 5 | Google Tag Manager, Adobe Experience Platform Tags, Tealium |
| Advertising | 19 | Meta Pixel, Google Ads, TikTok Pixel, LinkedIn Insight Tag, Microsoft Advertising |
| A/B testing | 9 | Optimizely, VWO, AB Tasty, Dynamic Yield |
| Marketing automation | 26 | HubSpot, Klaviyo, Mailchimp, Marketo, Pardot, ActiveCampaign |
| Live chat | 19 | Intercom, Zendesk, Drift, Tawk.to, Crisp, Gorgias |
| Payment | 16 | Stripe, PayPal, Klarna, Shop Pay, Afterpay, Adyen |
| Consent manager | 20 | OneTrust, Cookiebot, Usercentrics, Didomi, TrustArc |
| Fonts | 7 | Google Fonts, Adobe Fonts, Font Awesome |
| Video | 14 | YouTube, Vimeo, Wistia, JW Player, Mux |
| Security | 17 | reCAPTCHA, hCaptcha, Cloudflare Turnstile, DataDome, Imperva, Akamai Bot Manager |
| Search | 11 | Algolia, Klevu, Searchspring, Doofinder |
| Monitoring | 14 | Sentry, New Relic, Datadog RUM, Dynatrace |
| Reviews | 10 | Trustpilot, Yotpo, Judge.me, Bazaarvoice |
| Maps | 4 | Google Maps, Mapbox, Leaflet |
| Widgets | 15 | Disqus, Google Sign-In, accessiBe, UserWay |

The fingerprint table is our own, written from how each product shows itself in public (its host
names, headers, cookie names and documented markers).

## How it works, and its limits

- **One request per website.** The Actor fetches the page like a browser would (following
  redirects, reading up to 2 MB of HTML) and looks at the response headers, the names of the
  cookies it sets, meta tags, the addresses of scripts, stylesheets and iframes, inline scripts and
  HTML markers. It makes no second request.
- **No browser, no JavaScript execution.** Technologies that a page loads only at runtime (a chat
  widget injected by a tag manager, analytics added by a consent banner after you click "accept")
  are not in the HTML and **can be missed**. So can anything hidden inside bundled code, and
  server-side software that leaves no trace in one response: a Django or Laravel site often shows
  nothing but its web server. Expect a correct but incomplete list.
- **Precision before recall.** A technology is reported only on a signal specific to it. A weaker
  signal is marked `"confidence": "medium"`. A missing technology does not prove it is absent.
- **The page you give is the page that is checked.** A shop's checkout or app may use more than its
  homepage shows. Add those addresses to the list if you need them.
- **Blocked websites.** Some sites answer automated requests with a bot challenge (Cloudflare,
  DataDome, Akamai, AWS WAF, Fastly) or with HTTP 401/403/429. Those get a row with
  `"blocked": true` holding only what the response headers reveal, and are not charged. A
  proxy in the input sometimes helps; the Actor itself does not try to get around a challenge.
- **Websites that cannot be read** (the domain does not resolve, no answer, an invalid HTTPS
  certificate, an error status, not an HTML page) are listed with the reason in the run's `SUMMARY`
  record (key-value store) and in the log. They are not charged, and the rest of the run carries
  on. The run fails only when the input is invalid or no website at all could be reached.
- **A bare domain** (`example.com`) is tried over https first, then once over http if https cannot
  connect.
- **Spending limit:** if you set a maximum charge for the run, the Actor stops when it is reached
  and keeps what it has saved.
- Only the public page is read: no login, no personal data.

## Typical uses

Lead lists by technology ("which of these 500 stores run Shopify with Klaviyo?"), competitor and
market research, sales qualification, checking a migration or a tag rollout across your own sites,
security and vendor reviews, enriching a company list for an LLM or agent.

## Tests

`src/lib.js` holds the pure logic (input checks, URL building, parsing); `src/main.js` holds the network
and storage code. The unit tests in `test/lib.test.js` run `lib.js` against saved answers of the live
sources. Those files are copies of third-party pages and API answers and are **not included in this
repository**, so `npm test` says so and skips. To run them, save your own captures under `test/fixtures/`
with the file names the test reads. The live check is `node test/run_local.mjs @input.json`.

## Hosted version

To run it in the cloud, on a schedule or through an API, without installing anything: [Website Tech Stack Detector: Technologies with Evidence on Apify](https://apify.com/sebdata/tech-stack-detector) (paid per result).

## Who made this

This tool and its code were written by an AI agent (Anthropic's Claude), under a human account owner. Problems and wrong results: open an issue. MIT licence, no warranty.
