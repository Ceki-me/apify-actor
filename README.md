# Ceki Real Browser Fetch — Apify Actor

Fetch pages that block ordinary scrapers. Every request runs through a **real
Chrome browser with an already-warmed profile**, rented from the Ceki
marketplace — genuine fingerprint, real cookies, real browsing history.

## Why this is different

Most anti-bot actors spin up a fresh headless browser on a datacenter IP for
every request. Sites score a fresh profile as a bot regardless of how good the
stealth patches are, because there is no history behind it.

Ceki sessions persist. The first request rents a browser; every request after
that **resumes the same session**, so the site sees a profile that has been used
before, with cookies and history intact. That is what gets through behavioural
challenges that a cold profile cannot.

## How it works

This Actor is a thin HTTP client. It posts URLs to the Ceki fetch service and
writes the answers to the dataset — no browser automation, no CDP, no session
management in here.

```
Apify Actor (this repo)
  │  POST /v1/fetch
  ▼
Ceki fetch service — owns a pool of warmed sessions
  │
  ▼
rented Chrome
```

The split is deliberate. This repository is public, so it contains only the
client. Session handling, challenge solving, and the warmed profiles stay behind
the endpoint.

## Input

| Field | Type | Description |
|---|---|---|
| `urls` | string[] | **Required.** Pages to fetch. One dataset item and one charge each. |
| `browserId` | integer | Pin every URL to one pool slot. Omit to let the service pick any free worker. |
| `waitUntil` | `load` \| `networkidle` \| `selector` | How long to wait after navigation. Default `load`. |
| `waitSelector` | string | CSS selector to await. Only with `waitUntil: selector`. |
| `networkIdleMs` | integer | Quiet window for `networkidle`. Default `500`. |
| `timeoutSecs` | integer | Per-URL budget. Default `60`. A timeout fails that URL, not the run. |
| `returnFields` | array | Any of `html`, `cookies`, `screenshot`. Default `["html"]`. |
| `fullPageScreenshot` | boolean | Capture the whole scrollable page. Default `false`. |
| `solveChallenge` | boolean | Click through a Cloudflare interstitial. Default `true`. |
| `concurrency` | integer | URLs in flight at once. Default `4`, max `16`. |

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
  "challengeSolved": false,
  "timing": { "queueMs": 3, "navigateMs": 840, "waitMs": 500, "extractMs": 210, "totalMs": 1553 },
  "worker": { "id": 0, "browserId": 58164, "reacquired": false }
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

Two secret environment variables on the Actor:

| Variable | Meaning |
|---|---|
| `CEKI_FETCH_URL` | Base URL of the fetch service, e.g. `https://fetch.ceki.me`. |
| `CEKI_FETCH_KEY` | Service key issued for this Actor. |

Optional: `CEKI_FETCH_TIMEOUT_SECS` — client-side ceiling for one service call,
default `300`.

The Actor never holds a Ceki agent token. That token can rent browsers and spend
money; it lives only on the service.

## Running locally

```bash
npm install
npm run build
CEKI_FETCH_URL=http://127.0.0.1:8080 CEKI_FETCH_KEY=sk_live_abc \
  npx apify run --purge
```

## Session model

```
request 1:  worker acquires a session  → navigate → extract → session stays open
request 2:  same worker, same session  → navigate → extract
...
```

The session is held by the service, not by this Actor. An Actor run is
short-lived by design; the pool is not.

## Known limitations

- **Throughput is bounded by the service's worker count**, which is bounded by
  the number of browser slots. Requests above that wait in a queue rather than
  failing.
- **`cookies` and `screenshot` are best-effort.** Some providers restrict the
  CDP domains they forward. `html` is always returned.
- **A pinned `browserId` serialises.** Every request for that slot goes through
  one worker, one at a time. That is the point of pinning, but it is not a way
  to get parallelism.

## License

Apache-2.0
