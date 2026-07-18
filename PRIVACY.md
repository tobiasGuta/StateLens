# StateLens Privacy Notice

StateLens is designed for local, user-controlled security research.

## Data handling

- Project configuration and captured observations remain in IndexedDB in the current Chrome profile.
- No telemetry, analytics, crash reporting, advertising, or usage measurement is collected.
- No captured traffic is sent to StateLens developers or any third party.
- StateLens has no backend and does not use remote AI or cloud synchronization.
- The extension does not make target requests, inject scripts, or operate when its DevTools recorder is not active.

## Sensitive values

Likely secrets are redacted before persistence and before export. This includes authorization and proxy-authorization headers, cookies, session identifiers, passwords, CSRF values, API keys, access and refresh tokens, client secrets, private keys, and common cloud credentials.

Project-specific random salts and HMAC-SHA-256 fingerprints allow limited local correlation without preserving the original header value. The project salt is excluded from exported evidence. The MVP does not offer an unredacted export or persist a “revealed” state.

Redaction is a defense-in-depth control, not a guarantee that every application-specific secret format will be recognized. Review exports before sharing them.

## Scope and minimization

Recording requires an explicit enabled scope rule. StateLens checks scope before it requests response content. Out-of-scope requests are counted without storing their URL, headers, query, or body. A project may explicitly opt into displaying only the normalized hostname of ignored requests during the current session.

Oversized, unsupported, binary, or base64 bodies are omitted. Size, state, reason, and a cryptographic hash are retained when practical. Multipart upload content is not stored automatically.

## User control

Users choose when recording starts and stops, what projects exist, what is exported, and when local data is deleted. Export initiation and purge are independent actions. An initiated download is not treated as proof that a file was saved, and purge never claims that a backup exists. Purge requires the exact project name and explicit confirmation.

Removing the extension through `chrome://extensions` removes extension-controlled browser storage according to Chrome's behavior. Protect exported files separately; they are outside StateLens after download.

## Chrome permissions

The MVP requests no Chrome permissions and no host permissions. It relies on the DevTools Network API while DevTools is open.
