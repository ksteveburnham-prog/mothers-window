# CLAUDE.md

Persistent context for this project. Read this before doing anything.

## What this is

Originally a plain-language page for the author's mother, showing which
ferries she could see from her fourth-floor balcony in West Seattle. As of
2026-07-25, replaced with a technical dashboard for the author's own use: a
schematic map plus a data-rich list of every vessel visible from that same
window — Washington State Ferries (via WSDOT) and all other AIS-broadcasting
traffic (via aisstream.io), including commercial and, when it happens to
broadcast, military vessels.

The original mom-facing version isn't lost — it's recoverable from git
history — but this file describes the project as it exists now.

## Who I am

I am a **novice developer**. I am comfortable in the Mac Terminal but I do
not know JavaScript well.

**Teaching mode is on.** As you work:

- Explain what you are about to do before you do it, in plain language.
- After writing a chunk of code, explain what it does and why.
- When you choose between two approaches, say what the alternatives were.
- If I ask for something that is a bad idea, say so before doing it.
- Expand acronyms the first time you use them.

Do not produce working code silently. I have to maintain this. This applies
just as much now that the page is technical (real units, a map) as it did
for the old plain-language version — "technical audience" doesn't mean
"skip the explanations."

## Architecture

Now spans **two separate Cloudflare deployments**, not one:

1. **Cloudflare Pages** (private GitHub repo `ksteveburnham-prog/mothers-window`)
   — the site itself: `index.html`, `config.js`, and Pages Functions.
2. **A separate Cloudflare Worker** (`ais-tracker/`) — holds the `AisTracker`
   Durable Object, which keeps a persistent WebSocket connection to
   aisstream.io open. Cloudflare Pages **cannot** host a Durable Object
   itself (confirmed directly against Cloudflare's docs while building
   this) — that's the only reason this second deployment exists. It's bound
   into the Pages project via `wrangler.toml`.

```
mothers-window/
├── CLAUDE.md
├── SPEC.md
├── .gitignore
├── wrangler.toml            # Pages project config: binds AIS_TRACKER
├── index.html               # map + list dashboard: markup, styles, script
├── config.js                # her position and measured sightline sectors
├── robots.txt               # Disallow: /
├── _headers                 # X-Robots-Tag: noindex
├── functions/
│   └── api/
│       ├── ferries.js       # proxies WSDOT ferry positions
│       └── vessels.js       # proxies the AisTracker Durable Object
└── ais-tracker/             # SEPARATE Cloudflare Worker deployment
    ├── wrangler.toml        # declares the AisTracker class + migration
    └── src/
        └── worker.js        # the Durable Object + its Worker entrypoint
```

Cloudflare Pages settings: no build command, build output directory `/`. The
`functions/` directory is picked up automatically. `ais-tracker/` is deployed
separately (`wrangler deploy` run from inside that folder) — it is not part
of the Pages build in any way.

## Hard constraints

1. **No build step.** No npm install, no bundler, no framework, no
   TypeScript, no package.json — for either deployment. Plain HTML, CSS, and
   JavaScript. `wrangler.toml` is deploy configuration, not a build step.
2. **No external libraries.** No CDN links, no npm packages. aisstream.io
   sends plain JSON over its WebSocket, so no AIS-decoding library was ever
   needed — this held up even through adding the whole AIS pipeline.
3. **Secrets live only in Cloudflare environment variables**, never in the
   repo: `WSDOT_ACCESS_CODE` (Pages project) and `AISSTREAM_API_KEY`
   (the `ais-tracker` Worker, separately). Never in `config.js`, never in
   any file either deployment sends to the browser.
4. **The page calls `/api/ferries` and `/api/vessels` on its own origin.**
   Same-origin `fetch()`, no CORS, no JSONP.
5. **Nothing may make the URL discoverable.** No sitemap, no analytics, no
   third-party embeds, no public links.

**Retired as of 2026-07-25** (applied to the old mom-facing version; see git
history before reviving any of these): no map, no jargon, ferries-only
scope, nothing to click, 20px minimum body text.

## Security posture

There is no login. The page is protected only by having an unguessable URL.

- The Cloudflare Pages project name must be random, not "mothers-window" —
  the project name becomes the subdomain.
- `robots.txt` disallows everything; `_headers` sends `X-Robots-Tag: noindex`.
- The GitHub repo stays private, because the URL appears in its settings.

`config.js` contains home coordinates and a description of a specific
window's sightline. That's still why this page isn't simply public, even
though the audience changed.

## Testing

Two dev servers now, run at once, in two different terminal tabs:

1. Inside `ais-tracker/`: `npx wrangler dev` — needs `AISSTREAM_API_KEY` in
   `ais-tracker/.dev.vars`.
2. In the project root: `npx wrangler pages dev . --do AIS_TRACKER=AisTracker@mothers-window-ais-tracker`
   — needs `WSDOT_ACCESS_CODE` in the root `.dev.vars`.

Simpler alternative for the Pages side alone: push to a branch and use the
Cloudflare preview deployment. The `ais-tracker` Worker still needs its own
independent deploy either way — there's no bundled equivalent of the Pages
preview for it.

## Design rules (current: technical dashboard, not mom-facing)

- Real units are fine and expected: degrees, knots, feet. This is for a
  technical reader now, not a plain-language reader.
- The map is a hand-drawn SVG schematic, not real cartography or a tile
  provider — no external library, no map API key, no ongoing cost. Distances
  and angles are computed from real data; the shoreline itself isn't drawn.
- Every vessel — ferry or AIS — is checked against the same two sectors from
  `config.js`. Vessels outside them (or beyond `maxDistanceMiles`) are
  dimmed, not hidden — the map's point is to show what's actually blocked by
  trees/buildings versus actually visible, for any vessel, not just ferries.
- AIS does not carry tonnage, by design of the AIS standard itself. Length ×
  beam (from AIS static data, free) is shown instead. Don't reintroduce a
  tonnage figure without deliberately adding a separate paid vessel-database
  API and accepting that cost — it was a conscious tradeoff, not an oversight.
- The military category in the legend will rarely populate, because military
  vessels generally don't broadcast AIS. That's expected, not a bug — don't
  "fix" it by trying harder to find military traffic.

## Things that will bite

- **Her two sightline sectors, not one wedge, still apply** — see SPEC.md.
  `isVisible()` in `index.html` tests membership in *either* sector, widened
  by `bearingTolerance`, and this logic is now shared by every vessel type,
  not just ferries. Don't collapse it into one range.
- **All bearings still carry roughly ±5° of uncertainty** from the original
  photo-based sector measurement. Prefer false positives (dimmed-but-shown)
  to false negatives (vessel missing entirely).
- **Durable Objects can't live inside a Cloudflare Pages project.** This
  cost real time to discover — Cloudflare's own docs are explicit that a DO
  class must be deployed as its own Worker and bound in via `script_name`.
  Don't try to inline `AisTracker` into `functions/`.
- **The AIS vessel table needs active pruning.** Unlike the fixed ~25-vessel
  WSDOT ferry fleet, hundreds of distinct vessels can pass through the
  bounding box over many days. `ais-tracker/src/worker.js` drops any vessel
  not heard from in 10 minutes (`STALE_MS`) — removing that reintroduces
  unbounded memory growth in a Worker meant to run for days.
- **A vessel's name can lag its position.** AIS position reports arrive far
  more often than static data (name, type, dimensions). A newly-appeared
  vessel may show as "Unknown vessel (MMSI …)" for a little while before its
  name arrives — that's correct behavior, not a bug.
- **Durable Object cost is a docs-based estimate, not a measured one.** It
  looks likely to fit Cloudflare's free tier for this low-volume, one-region
  use, but this should be confirmed against the real Cloudflare dashboard
  after a day of live usage, not assumed.

## Git

Commit in small, readable steps with plain-English commit messages.
