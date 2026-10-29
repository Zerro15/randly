# Randly local QA report

**Date:** 2026-10-29
**Branch:** `feat/accounts-shared-rooms`
**PR:** [#1](https://github.com/Zerro15/randly/pull/1)
**Environment:** isolated Docker Compose projects `randly-qa-20261029` and `randly-recipient-qa-20261029`, local Chromium via Playwright. No VPS or existing user database was accessed.

## Result

| Area | Status | Evidence |
|---|---|---|
| Docker config, image build and health checks | PASS | `docker compose config --quiet`; `up -d --build --wait`; both services healthy |
| API and generator tests | PASS | 5 Python API tests; 5 Node random-core tests |
| Browser regression tests | PASS | Auth-submit, empty-boundary and prepared-room Playwright regressions |
| Generator UI | PASS | Clicked all 8 tools; validated 1–4, 1–9, negative and equal bounds, exclusions, unique exhaustion, teams, dice, themes, projector, history, import/export, copy, saved sets, repeat, demo and keyboard shortcut |
| Account and settings | PASS | Register, duplicate registration, correct/wrong login, logout, reload persistence, cross-context preferences, protected API, cookie flags |
| Shared rooms | PASS | 3 guests, QR SVG, clipboard success, history/reset/reload/reconnect, guest authorization, concurrent host draws, common result |
| Prepared assignments | PASS | Guest name and registered `@login`; future names hidden from 3 independent guests; only opened results reveal as `Максим — задание №7` |
| Responsive layout | PASS | 360×800, 390×844, 430×932, 768×1024, 1280×800, 1920×1080; no horizontal overflow on account or room pages |
| Local 40/100-client load | PASS | 0 failed read requests; concurrent unique draws succeeded for all clients |
| Public VPS / production HTTPS | NOT TESTED | Explicitly outside this local-only audit |

No unresolved test failures remain. The browser console had no JavaScript errors. An unauthenticated page load intentionally receives HTTP 401 from `/api/auth/me` before account state is known.

## Bugs fixed

1. **SQLite connections were not closed.** The API used `with sqlite3.connect(...)`, which commits transactions but does not close the connection. On Windows, API tests then failed while deleting their temporary SQLite databases. `connect()` now closes in `finally` while preserving transaction handling. The Windows API suite now passes.
2. **Account form stopped after successful registration/login.** The async handler read `event.currentTarget` after an `await`, when the browser had cleared it. The submitted form is now captured before awaiting. A Playwright regression verifies that registration reaches the signed-in profile.
3. **Blank number bounds became zero.** `Number('')` silently produced `0`. Empty boundaries are now rejected, with a Playwright regression for the validation message.

Regression and API coverage also checks password hashing, eight-attempt login throttling, cross-site request rejection, simultaneous no-repeat draws, exhausted pools, and negative/zero room values.
The browser regression scripts under `tests/` require Playwright to be installed in the local Node environment.

## Prepared assignments

The private organizer panel now submits a required recipient name or `@login` to the existing room reservation API. API tests verify canonical login normalization, reject unknown logins, and confirm that neither future numbers nor names appear in public room state. Three independent guest contexts then observed one shared sequence: an ordinary random result, `Максим — задание №7`, another random result, and the registered participant's `@login — задание №9`. The public room retains the explicit **Подготовленное распределение** notice and renders recipients as text. An unauthenticated guest received 401 for the private endpoint; a different registered account received 403.

## Load measurements

Local synthetic guest workers made repeated room-state and homepage requests. Each worker then issued a simultaneous host draw against a no-repeat pool. Latency is seconds; CPU and memory are instantaneous Docker snapshots taken at the end of each run, not peak samples.

| Concurrent clients | Guest requests | Errors | p50 | p95 | p99 | Guest req/s | Concurrent unique draws | Draw p95 | CPU/RAM snapshot (frontend; API) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 40 | 400 | 0 (0%) | 0.0202 | 0.1342 | 0.1523 | 637.17 | 40/40 | 0.6647 | 0.00%, 22.19 MiB; 0.18%, 48.86 MiB |
| 100 | 1,000 | 0 (0%) | 0.0496 | 0.3782 | 0.4236 | 568.66 | 100/100 | 1.1033 | 0.02%, 29.95 MiB; 0.18%, 49.77 MiB |

A separate browser run with three guest contexts observed the same result in all guests after two simultaneous organizer draws; update arrived in about 1.8 seconds (the room poll interval is two seconds). Room state remained after an API container restart using the isolated test volume. These local results do not establish comparable capacity on a VPS or over real mobile networks.

## Routing and security checks

- Local Caddy reverse proxy served the app under `/randly/`; static assets and `/api/health` routed successfully. An authenticated session worked with cookie `Path=/randly/`.
- Default local run emitted a session cookie with `HttpOnly`, `SameSite=Strict`, and `Secure` enabled.
- Guest requests to protected room actions returned 401; cross-origin API writes returned 403; room QR endpoint returned `image/svg+xml`.
- The path-prefix proxy was local HTTP. Public TLS certificates and real HTTPS termination were not exercised.

## Screenshots

Screenshots are in `qa-artifacts/screenshots/`:

- Generator: `generator-light-360.png`, `generator-dark-1280.png`
- Wheel and settings dialog: `wheel-1280.png`, `settings-1280.png`
- Account and room layouts at all six requested widths: `account-{360,390,430,768,1280,1920}.png` and `room-{360,390,430,768,1280,1920}.png`
- Prepared assignment after reveal: `prepared-room-after-reveal.png`

Raw responsive and load measurements are in `qa-artifacts/browser-results.json` and `qa-artifacts/load-results.json`.

## Remaining deployment checks

**Ready for a controlled single-node deployment after configuring HTTPS termination and backups. Not a production-capacity certification.** Before public production traffic, verify TLS and cookie behavior at the actual reverse proxy, backup/restore of the SQLite volume, resource limits under expected demand, and any multi-instance rate limiting needs. The login limiter is process-local, so it does not coordinate across multiple API workers or hosts.
