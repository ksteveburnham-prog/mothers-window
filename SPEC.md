# SPEC.md — Puget Sound Traffic Dashboard (formerly "Mother's Window")

## Goal

Originally: she looks out from the balcony, sees a boat, and wants to know
what it is, in one glance, in plain language.

As of 2026-07-25: a technical dashboard for the project's author, covering
the same physical window and the same measured sightline, but showing every
vessel in view — Washington State Ferries plus all other AIS-broadcasting
traffic (commercial, and military when it happens to broadcast) — as a
schematic map with ship icons, alongside a detailed list (heading, speed,
size, distance).

The mom-facing version and its "success is that she stops wondering" framing
still exist in git history. This document describes the dashboard as it
exists now.

## Scope (current)

- **Washington State Ferries**, via the WSDOT Ferries API (unchanged from
  the original Phase 1).
- **All AIS-broadcasting vessels** within the visible region, via
  aisstream.io — commercial traffic of any kind, and military vessels on the
  rare occasions they broadcast (most military vessels run with AIS off).

## Her position

Derived from four independent iPhone EXIF fixes taken 3–25 July 2026, all
agreeing to within a few metres. Still the anchor point for every distance
and bearing calculation on the dashboard, for ferries and AIS vessels alike.

| Property | Value |
|---|---|
| Latitude | 47.560742 N |
| Longitude | -122.386503 W |
| Elevation | ~96 m / 315 ft (GPS, ±10 m) |

## The sightline — two sectors, not one

Measured from a wide-angle balcony photo (compass heading 265.78° true, 26 mm
equivalent, 69.4° horizontal field of view, so the frame spanned 231°–300°).

| Sector | Bearings | Status |
|---|---|---|
| South window | **231°–245°** | Open water. True southern limit unmeasured — see Calibration. |
| Tree gap | 245°–266° | Blocked. Large deciduous tree and a conifer. |
| West window | **266°–280°** | Open water. |
| North | 280° and above | Blocked. |

**Everything here carries about ±5° of uncertainty.** See `config.js` for
the exact numbers, including `bearingTolerance`.

This still governs the dashboard's dimmed-vs-full-strength rendering (see
Algorithm below) for every vessel, not just ferries — the two-sector shape
matters just as much for a cargo ship as it did for a ferry.

## Data sources

**WSDOT Ferries API**, vessel locations endpoint, fetched by
`functions/api/ferries.js`:

```
https://www.wsdot.wa.gov/Ferries/API/Vessels/rest/vessellocations?apiaccesscode=KEY
```

Fields used: `VesselName`, `Latitude`, `Longitude`, `Speed`, `Heading`,
`InService`, `AtDock`, `DepartingTerminalName`, `ArrivingTerminalName`.

**aisstream.io**, a free WebSocket AIS (Automatic Identification System)
feed, connected to by the `AisTracker` Durable Object
(`ais-tracker/src/worker.js`), not by the browser or by a Pages Function
directly:

```
wss://stream.aisstream.io/v0/stream
```

Subscribed with a bounding box covering both sectors out to
`maxDistanceMiles`, plus margin (see `BOUNDING_BOX` in `worker.js`). Message
types used: `PositionReport` (`Latitude`, `Longitude`, `Sog` = speed over
ground in knots, `Cog` = course over ground, `TrueHeading`) and
`ShipStaticData` (`Name`, `Type` = numeric ship-type code, `Dimension.A/B/C/D`
→ length/beam, `Destination`, `CallSign`).

**AIS does not carry tonnage, at all** — it was never part of the standard.
Length × beam, computed from `Dimension`, is shown instead. Getting real
tonnage would require a separate paid vessel-database API (VesselAPI,
Datalastic, etc.) — a deliberate scope decision, not an oversight.

## Algorithm

For each **ferry**:
1. Discard if `InService` is false. (Unlike the original Phase 1 page,
   `AtDock` ferries are *kept*, not discarded — this dashboard shows the
   whole picture, not just newly-moving traffic.)
2. Compute bearing and haversine distance from her position.
3. Discard if beyond `maxDistanceMiles`.

For each **AIS vessel**:
1. Discard if no position has ever been received (static data alone isn't
   enough to place it).
2. Compute bearing and distance the same way.
3. Discard if beyond `maxDistanceMiles`.
4. The `AisTracker` Durable Object itself drops any vessel not heard from in
   10 minutes, independent of this — see "Things that will bite" in
   CLAUDE.md.

For everything that survives (ferry or AIS), the same sector test applies:
**inside either sector (widened by `bearingTolerance`) → shown at full
strength; within `maxDistanceMiles` but outside both sectors → shown dimmed,
not hidden.** This is a change from the original Phase 1 behavior, which
silently discarded non-visible ferries — the dashboard's whole point is to
show what's geometrically nearby versus what's actually visible from the
window, for any vessel.

Sort combined results by distance, nearest first.

## Display

- **Map**: a hand-drawn SVG schematic, not a real chart. Her window is a
  fixed anchor point; both sectors are drawn as translucent wedges; vessels
  are small icons, shaped and colored by category (ferry, cargo, tanker,
  tug, fishing, military, pleasure, service, other — see
  `CATEGORY_SHAPES`/`CATEGORY_LABELS` in `index.html`), rotated to each
  vessel's own heading, dimmed if outside her sectors.
- **List**: name (falls back to "Unknown vessel (MMSI …)" until AIS static
  data arrives), category, route or destination, distance, heading in
  degrees, speed in knots, size in feet when known.
- Refresh every 30 seconds. "Updated at 2:14 pm" shown on any successful
  fetch. Ferries and AIS vessels are cached independently, so one source
  failing never blanks data from the other — never blank the screen, never
  show a raw error.

## Architecture note

A Cloudflare Pages project **cannot** host a Durable Object directly —
confirmed against Cloudflare's own docs while building this. That's why
`ais-tracker/` exists as an entirely separate Worker deployment, bound into
the Pages project via `script_name` in `wrangler.toml`. See CLAUDE.md's
Architecture section for the full file layout.

## Known limitations

- AIS carries no tonnage field — length × beam substitutes for it.
- Military vessels generally run with AIS off, so the military category
  will rarely populate. That's expected, not a bug.
- A vessel's name can lag its position by a while, since AIS position
  reports arrive far more often than static (name/type/dimension) data.
- Durable Object cost is currently a docs-based estimate ("likely fits the
  free tier for this low-volume, single-region use"), not yet confirmed
  against real Cloudflare billing data.

## Calibration — still worth doing, still not optional

The sectors are measured but the error bar is wide, and the south window's
lower limit was never captured. This still matters for the dashboard's own
dimmed-vs-visible accuracy, not just for the old plain-language page:

1. Watch for a **Southworth ferry** (or any vessel crossing a sector edge)
   and note the clock time it enters and leaves a sector.
2. Look up where it was at those two times.
3. Compute the bearing from her position to each point — those are the true
   sector edges. Put them in `config.js`.

## Phase 2 — done, ahead of the original schedule

The original plan here said: "Ship Phase 1 and let her use it for a few
weeks before deciding whether [AIS] complexity is worth it." That advice was
explicitly overridden by the project's author on 2026-07-25, who wanted the
full map + AIS dashboard immediately, for personal/technical use rather than
for his mother. The tradeoffs the original plan worried about (a Pages
Function can't hold a persistent connection; AIS needs a lookup table
mapping vessel identifiers to names) were real and are addressed by the
`AisTracker` Durable Object described above, not avoided.
