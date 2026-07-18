# StateLens

[![CI](https://github.com/tobiasGuta/StateLens/actions/workflows/ci.yml/badge.svg)](https://github.com/tobiasGuta/StateLens/actions/workflows/ci.yml)

**Business Logic and Authorization Workflow Mapper**

StateLens is a local-first Chrome DevTools extension for authorized bug bounty hunters and penetration testers. It records completed requests from a deliberately scoped workflow, preserves sanitized evidence, and helps a human understand how an application behaves across accounts and actions.

StateLens is not an exploitation tool. The MVP does not replay requests, modify traffic, scan targets, make vulnerability claims, use AI, or send captured data to a remote service.

## MVP capabilities

- Manifest V3 DevTools panel with no required or optional host permissions
- Local projects with explicit exact-host, subdomain, and URL-prefix scope rules
- Account contexts without passwords or raw credentials
- Draft, recording, and completed workflows
- Manual action markers
- Completed-request capture through `chrome.devtools.network`
- Scope validation before response content is requested
- Request and response metadata, JSON/form/text parsing, and multipart metadata
- Conservative request/response, JSON-depth, object-key, observation-count, and project-size limits
- Redaction of authorization, cookies, token fields, passwords, client secrets, private keys, and common cloud credentials
- Project-specific HMAC-SHA-256 fingerprints for redacted header values
- Versioned IndexedDB storage with Zod validation, atomic observation/workflow writes, recoverable invalid-record errors, and complete project purge
- Timeline and redacted observation-detail views
- Sanitized JSON export initiation with exact byte size and SHA-256 receipt
- Separate typed-confirmation project purge with record counts
- Recording-session generations, response-content timeout, and bounded stop draining
- Exact event-object duplicate suppression while preserving separate identical and concurrent requests
- Per-session positive sequence numbers for deterministic ordering when timestamps are equal
- Explicit workflow-finalization and interrupted-session recovery without resuming network capture

Workflow comparison, identifier correlation, state inference, explainable hypotheses, Markdown evidence reports, cURL, and raw HTTP export are intentionally reserved for later phases. They are not represented as working features in this release.

## Screenshots

Screenshots will be added after the first manual Chrome verification pass.

- Dashboard: _placeholder_
- Scoped workflow recorder: _placeholder_
- Evidence timeline and observation detail: _placeholder_

## Development

Requirements:

- Node.js 20 or newer
- npm 10 or newer
- A current Chromium-based browser for manual verification

Install and run all checks:

```powershell
npm.cmd install
npm.cmd run format:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run verify:dist
npm.cmd run check:forbidden
```

The built extension is written to `dist/`. Node.js is not required after the extension is built.

## Load the unpacked extension

1. Run `npm.cmd run build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the generated `dist` directory.
5. Open DevTools on an authorized target.
6. Select the **StateLens** panel. If the panel is not present, close and reopen DevTools after loading the extension.

StateLens only observes requests visible to the DevTools Network API after recording starts. Open DevTools before loading the target page and reload after starting a recording to capture a complete workflow.

## Use a scoped workflow

### Create a project

Open **Project Settings**, enter a target or engagement name, and create the project. StateLens generates a random project salt locally for token fingerprints.

### Configure scope

Add at least one explicit rule:

- `exact-host`: one hostname, optionally pinned to a scheme and port
- `subdomain`: the named host and real DNS subdomains, with label-boundary checks
- `url-prefix`: an HTTP(S) origin and path prefix, with scheme, port, and path-boundary checks

Recording stays disabled until an enabled rule exists. Similar-looking suffixes such as `example.test.evil.test` do not match `example.test`. Redirects to other hosts are flagged as out of scope.

Host rules distinguish scheme-only input from an explicitly supplied port. For example, `https://example.test` allows HTTPS on any port, while `https://example.test:443` requires effective port 443 even though the browser URL parser normally hides that default port. URL-prefix rules always pin their origin, and their normalized display preserves explicitly supplied `:443` or `:80`.

### Create an account context

Give the context a descriptive name such as `Anonymous`, `Account A`, `Member`, or `Organization owner`. Role and tenant labels are optional. Never enter a password, cookie, token, or other credential in account notes.

### Record a workflow

1. Create a workflow while the intended account context is selected.
2. Select **Start recording**.
3. Reload the inspected page if the initial traffic matters.
4. Add action markers immediately before or after meaningful UI actions.
5. Select **Stop recording** when the workflow is complete.

Out-of-scope requests are counted without requesting or storing their bodies. Ignored hostnames are hidden unless the project explicitly enables hostname display.

Separate Chrome event objects are preserved even when their timestamp, method, URL, status, and POST body are identical. Only delivery of the exact same event object twice in one session is suppressed. Each admitted in-scope request receives a `sessionSequence` starting at 1; this sequence remains stable even if concurrent response bodies finish out of order.

Stopping drains admitted work before atomically reconciling stored observations, ending open markers, and completing the workflow. If final persistence fails, StateLens enters a blocking finalization-recovery state. The analyst can retry or export evidence, but cannot start another recording, switch capture context, edit scope, or purge until finalization succeeds.

On startup, a stored `recording` workflow with no live collector is treated as interrupted. StateLens never resumes it automatically. The analyst may finalize it as interrupted, keep it for review, or explicitly discard it only when it has no observations. Workflows kept for review remain available in the in-session **Interrupted workflows** section until they are reopened and resolved.

### Review evidence

Open **Timeline** and select a request. Equal timestamps are ordered by `sessionSequence`, which is also visible in request details and retained in exports. The detail pane exposes metadata, sanitized headers, parsed data, redaction status, body-limit decisions, hashes, and capture limitations. A missing or omitted body is evidence about capture availability, not evidence that the server returned no content.

### Export or delete

Open **Evidence** to initiate a sanitized JSON download. The final export path applies another recursive redaction pass and excludes the project fingerprint salt. StateLens displays the expected filename, SHA-256 of the exact exported bytes, byte size, and the honest status “download initiated”; it cannot determine whether Chrome saved the file.

Purge is a separate action and does not assume an export or backup exists. It is disabled during recording and draining, displays record counts, requires the exact project name, and asks for final confirmation.

## Synthetic Chrome harness

Run the two local-only servers in separate terminals:

```powershell
npm.cmd run demo
npm.cmd run demo:secondary
```

Open `http://localhost:4173`. The harness exercises supported bodies, fake sensitive values, limits, redirects, status boundaries, duplicates, and concurrency without real targets. Follow [docs/CHROME_VERIFICATION.md](docs/CHROME_VERIFICATION.md); its results remain `NOT RUN` until a human completes them.

## Privacy design

- Captured observations remain in IndexedDB in the current browser profile.
- StateLens has no telemetry, analytics, advertisements, cloud synchronization, remote AI, or remote fonts/scripts.
- It makes no target requests of its own and does not inject scripts into inspected pages.
- Secrets are redacted before persistence. Revealing or persisting raw secret values is not implemented in the MVP.
- Oversized and binary bodies are omitted; hashes and size metadata are retained when practical.
- There is no console logging of captured request or response bodies.

See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Permissions

StateLens requests no Chrome permissions and no host permissions. A DevTools page can subscribe to the inspected tab's completed network requests while DevTools is open. The Manifest V3 service worker is inert and performs no network activity.

The **Project Settings** page displays this permission posture and explains how to stop capture or revoke the extension from `chrome://extensions`.

## Current limitations

- Manual browser loading and target-page capture must be verified for each supported Chrome release.
- Chrome can make response content unavailable; StateLens records the limitation without inventing content.
- Response-content retrieval has a bounded internal timeout, and stopping uses a bounded drain before final workflow completion.
- Preserving legitimate duplicate traffic can increase local storage use; workflow observation limits still apply to every separate event.
- Interrupted or finalization-error workflows require explicit local recovery and cannot be silently resumed.
- Compressed responses are handled only as Chrome exposes them through `getContent`.
- Uploaded binary content is omitted; only multipart field/file metadata is retained.
- Ignored-request counters are session state and are not persisted as sensitive traffic records.
- Local browser profiles and extension storage are not a hardened evidence vault. Protect the host and browser profile.
- The MVP does not compare workflows, correlate objects, infer state, score hypotheses, or generate Markdown/cURL/raw HTTP.
- The MVP supports ordinary HTTP(S) DevTools requests, not complete WebSocket or GraphQL-specific analysis.

## Roadmap

1. Workflow endpoint, status, schema, and value comparison
2. Deterministic identifier extraction and transparent entity correlation
3. Conservative state-transition inference with correction controls
4. Explainable authorization, replay, idempotency, and race-condition candidates
5. Evidence builder plus Markdown, cURL, and raw HTTP exporters
6. Broader synthetic browser integration coverage

Every future candidate will remain unverified by default, include evidence observation IDs and human-readable reasons, and avoid vulnerability severity labels.

Production builds use the normal React output without post-build vendor rewriting. Source verification applies strict rules to StateLens-owned code; distribution verification separately checks manifest policy and actual external resource-loading paths while narrowly recognizing inert React, W3C, and JSON-Schema identifier strings.

## Responsible use

Use StateLens only on systems you own or are explicitly authorized to test. Configure the narrowest useful scope, follow the target's rules, minimize sensitive collection, and manually verify every hypothesis. StateLens does not grant authorization and cannot determine whether a test is permitted.

## License

Apache License 2.0. See [LICENSE](LICENSE).
