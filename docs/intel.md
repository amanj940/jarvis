# Intelligence layer (first slice)

The globe is the centre of the Jarvis intelligence view: opportunity
leads and bug-bounty programs/findings that have a location are plotted
on it as markers. Everything is read-only and local — no live feeds,
no geocoding API, no keys, no writes to the source stores.

## What you see

- **Green markers** — opportunity leads (`jarvis/plugins/opportunity/`).
  Click one to see its title, score, source, and the place it resolved to.
- **Amber markers** — bounty programs and findings
  (`jarvis/plugins/bounty/`). **Red** — findings with severity
  `critical` or `high`.
- Markers refresh every 5 minutes from `GET /api/intel/globe`.
  Toggle the layers off/on with the window event
  `jarvis:toggle-intel-layer` (same convention as the holo rings) or
  from the browser console:
  `window.dispatchEvent(new Event("jarvis:toggle-intel-layer"))`.
  There is no HUD button for this yet.

## Where a coordinate comes from

In priority order, per item:

1. **Explicit coordinates** — a lead's `lat` / `lon` columns
   (`jarvis/plugins/opportunity/leads.py`; nullable, added with a
   migration so old `opportunity.db` files keep working). Set them when
   a lead is added and the globe pins it exactly.
2. **City name in the text** — the lead title/notes/source or the
   bounty program name, matched against a curated table
   (`jarvis/plugins/intel/geo.py`): the same 69 cities the globe
   labels, plus tech hubs (San Francisco, Seattle, Austin, …).
3. **Company headquarters** — a program named after its company
   ("Google" → Mountain View, "HackerOne" → San Francisco,
   "Intigriti" → Antwerp, …). Same curated table, no network.

Every plotted item records *what* matched (`location_name`, `match`:
`explicit` / `city` / `company`), so a wrong pin is visible instead
of silent. Items with no location are **not plotted** — they are
counted as `unlocated` in the endpoint and tool output, so the globe
never silently hides data.

## Files

- `jarvis/plugins/intel/geo.py` — curated city + HQ tables, resolver.
- `jarvis/plugins/intel/store.py` — `IntelStore`, the read-only
  aggregator over the opportunity + bounty stores.
- `jarvis/plugins/intel/tools.py` — `intel_globe_items` and
  `intel_summary` (both SAFE).
- `jarvis/server/routes/intel.py` — `GET /api/intel/globe` and
  `GET /intel/summary`.
- `web/src/components/Globe/IntelLayers.ts` — fetches the endpoint,
  registers the two layers via `GlobeLayers`, toggle helpers.
- `web/src/components/Globe/EarthGlobe.tsx` — starts the layer on
  mount; clicking a marker shows a tooltip pill (title / score or
  severity / source / place) with a close button.
- `tests/test_intel.py` — geo lookup, leads migration, aggregation,
  tools, route handlers, discovery. No network, no keys.

## Try it

```bash
git pull origin ui-hud-upgrade
# backend + frontend restart, then open the HUD
```

Add a lead with a place in its title (e.g. "Dubai expansion deal")
or a bounty program named after a company, and its marker appears on
the globe. From chat: `intel_globe_items` lists the plotted items,
`intel_summary` the counts.

## Limits (deliberate, first slice)

- **Heuristic locations.** The resolver only knows the curated cities
  and HQs. A lead about a place we do not know stays unlocated, and a
  word like "Lima" in an unrelated title can mis-pin. Explicit `lat` /
  `lon` on the lead always wins — use it for anything important.
- **Overlapping pins.** Several programs share one HQ city (HackerOne,
  Bugcrowd, Stripe, … all resolve to San Francisco), so their markers
  stack on the same spot; clicking shows one of them. No clustering yet.
- **No live feeds, no real geocoding, no alerts, no dashboards.**
  The layer shows what is already in the local stores. Live platform
  APIs still need accounts/keys (see the bounty/YouTube docs).
- **No HUD toggle button yet** — the window event / console call above
  is the switch for now.
- **Marker click no longer toggles the mic** — fixed by the globe
  marker-click guard (`5a93a298`): a marker click reaches
  `onMarkerClick` and opens the tooltip without toggling the mic;
  the tooltip pill's own clicks are stopped too. Plain globe clicks
  still toggle the mic, as before.
- The live globe view was verified by `tsc` + `vite build` only, not
  in a live browser — try it on the user's machine after pull.
