# Ceki Real Browser Fetch — Apify Actor

Fetch pages that block ordinary scrapers. Every request runs through a **real
Chrome browser with an already-warmed profile**, rented from the Ceki
marketplace — genuine fingerprint, real cookies, real browsing history.

## Why this is different

Most anti-bot actors spin up a fresh headless browser on a datacenter IP for
every request. Sites score a fresh profile as a bot regardless of how good the
stealth patches are, because there is no history behind it.

Ceki sessions persist. The first run rents a browser; subsequent runs **resume
the same session**, so the site sees a profile that has been used before, with
cookies and history intact. That is what gets through behavioural challenges
that a cold profile cannot.

## Input

| Field | Type | Description |
|---|---|---|
| `urls` | string[] | **Required.** Pages to fetch. One dataset item and one charge each. |
| `browserId` | integer | Which Ceki browser to drive. Falls back to `CEKI_BROWSER_ID`. |
| `waitUntil` | `load` \| `networkidle` \| `selector` | How long to wait after navigation. Default `load`. |
| `waitSelector` | string | CSS selector to await. Only with `waitUntil: selector`. |
| `networkIdleMs` | integer | Quiet window for `networkidle`. Default `500`. |
| `timeoutSecs` | integer | Per-URL budget. Default `60`. A timeout fails that URL, not the run. |
| `returnFields` | array | Any of `html`, `cookies`, `screenshot`. Default `["html"]`. |
| `fullPageScreenshot` | boolean | Capture the whole scrollable page. Default `false`. |
| `keepSession` | boolean | Leave the session alive for the next run. Default `true`. |

## Output

One dataset item per URL:

```jsonc
{
  "url": "https://example.com",
  "ok": true,
  "status": 200,
  "finalUrl": "https://example.com/",
  "title": "Example Domain",
  "html": "<!DOCTYPE html>...",
  "cookies": [{ "name": "session", "value": "...", "domain": ".example.com" }],
  "screenshot": "<base64 PNG>",
  "timing": { "sessionMs": 1200, "navigateMs": 840, "waitMs": 500, "extractMs": 210, "totalMs": 2750 },
  "browser": { "scheduleId": 58164, "sessionId": "…", "resumed": true }
}
```

A failed URL reports `ok: false` and an `error` string. **Failures are not
charged.**

## Pricing

Pay per event:

- `page-fetched` — charged once per **successfully** retrieved page
- `apify-actor-start` — charged once per run

Platform usage (compute, storage) is billed by Apify on top, as usual.

## Setup

1. Create an agent key at [ceki.me](https://ceki.me).
2. Add it to this Actor's environment variables as a secret named `CEKI_TOKEN`.
3. Add `CEKI_BROWSER_ID` with the ID of a browser from your Ceki dashboard, or
   pass `browserId` in the input.

For local runs, copy `.env.example` to `.env` and fill in the values.

## Running locally

```bash
npm install
npm run build
CEKI_TOKEN=ag_xxx CEKI_BROWSER_ID=58164 \
  npx apify run --purge
```

## Session model

```
run 1:  no live session  → rent       → navigate → extract → detach (session stays alive)
run 2:  session found    → resume     → navigate → extract → detach
...
```

`keepSession: false` releases the browser at the end of the run instead.

## Known limitations

- **One URL at a time.** A rented browser has a single tab. Parallelism belongs
  at the Apify run level — schedule several runs against different browsers.
- **Throughput is bounded by your browser fleet.** Apify gives you concurrency;
  Ceki gives you the sessions. Size your fleet to match expected load.
- **`cookies` and `screenshot` are best-effort.** Some providers restrict the
  CDP domains they forward. `html` is always returned.

## License

Apache-2.0
