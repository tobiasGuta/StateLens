# Contributing to StateLens

StateLens welcomes careful contributions that preserve its local-first, human-led security model.

## Setup

Use Node.js 20 or newer:

```powershell
npm.cmd install
npm.cmd run build
```

Load the generated `dist` directory as an unpacked Chrome extension for manual DevTools testing.

## Code style

- Keep TypeScript strict and avoid `any`.
- Prefer small modules and pure deterministic analysis/security functions.
- Validate data at Chrome, parsing, storage, import, and export boundaries.
- Preserve React escaping; do not render captured data with `dangerouslySetInnerHTML`.
- Do not use `eval`, dynamic code loading, remote scripts, remote fonts, analytics, or telemetry.
- Never log captured traffic or credentials.
- Comment security-sensitive decisions and explain unusual tradeoffs.

Run before submitting:

```powershell
npm.cmd run format
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

## Testing expectations

Every behavior change needs focused tests. Security controls require bypass cases, including hostname confusion, mixed casing, nested data, malformed records, size/depth boundaries, and insufficient evidence. Test fixtures must be synthetic and use reserved example domains.

Manual Chrome checks should record the Chrome version and verify panel creation, recording start/stop, reload capture, unavailable-response handling, redaction, export, and project purge. Never use private or production target data in screenshots or issue attachments.

## Pull requests

Keep pull requests narrow. Describe the user-visible result, threat-model impact, migrations, permissions changes, tests run, and manual verification status. Do not describe an unfinished security analysis as implemented.

Changes that add permissions, remote communication, request replay/modification, secret reveal, import, or export formats require explicit security review and documentation updates.

## Security-sensitive contributions

StateLens is not an exploitation or scanning framework. Contributions must not add automated exploitation, high-concurrency race execution, payload spraying, brute force, automatic replay, silent scope expansion, hidden monitoring, credential harvesting, or vulnerability claims without human verification.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
