# Manual Chrome Verification Record

This checklist must be executed with only the bundled localhost harness and synthetic values. Do not attach real target traffic, credentials, cookies, private-program data, or personal information.

## Verification metadata

| Field                   | Value   |
| ----------------------- | ------- |
| Chrome/Chromium version | NOT RUN |
| Operating system        | NOT RUN |
| Commit SHA              | NOT RUN |
| Verification date       | NOT RUN |
| Tester                  | NOT RUN |

## Preparation

1. Run `npm ci`.
2. Run `npm run verify`.
3. In separate terminals, run `npm run demo` and `npm run demo:secondary`.
4. Open `http://localhost:4173` and confirm that only synthetic controls are shown.
5. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist`.
6. Open DevTools for the localhost demo page and select **StateLens**.

## Results

Record `PASS`, `FAIL`, or `BLOCKED` only after performing each item. All initial values intentionally remain `NOT RUN`.

|   # | Verification item                                                                                           | Result  | Notes / synthetic screenshot reference               |
| --: | ----------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------- |
|   1 | Production build completes and unpacked `dist` loads without a manifest error                               | NOT RUN |                                                      |
|   2 | StateLens DevTools panel appears after DevTools is reopened                                                 | NOT RUN |                                                      |
|   3 | Create a synthetic project and account context                                                              | NOT RUN |                                                      |
|   4 | Exact-host `localhost` scope matches both demo ports because no port is pinned                              | NOT RUN |                                                      |
|   5 | Scheme-qualified exact-host `http://localhost` rejects HTTPS                                                | NOT RUN |                                                      |
|   6 | Scheme-and-port exact-host `http://localhost:4173` rejects port 4174                                        | NOT RUN |                                                      |
|   7 | Subdomain scope preserves supplied scheme and non-default port semantics                                    | NOT RUN |                                                      |
|   8 | URL-prefix `http://localhost:4173/api` matches `/api/*` and rejects other paths                             | NOT RUN |                                                      |
|   9 | Out-of-scope request and redirect bodies are not retrieved or persisted                                     | NOT RUN |                                                      |
|  10 | Start recording, reload the demo page, and capture only post-start traffic                                  | NOT RUN |                                                      |
|  11 | Add a marker and immediately trigger JSON; observation contains the marker ID                               | NOT RUN |                                                      |
|  12 | Replace and explicitly end the active marker                                                                | NOT RUN |                                                      |
|  13 | Capture JSON, URL-encoded form, plain text, XML, and multipart metadata                                     | NOT RUN |                                                      |
|  14 | Authorization, cookies, sensitive response headers, JSON fields, and query tokens are redacted              | NOT RUN |                                                      |
|  15 | Large request and response exceed configured limits without crashing                                        | NOT RUN |                                                      |
|  16 | Binary content is omitted and base64 behavior is recorded safely                                            | NOT RUN |                                                      |
|  17 | 401 and 403 responses receive authorization-boundary metadata                                               | NOT RUN |                                                      |
|  18 | Duplicate and concurrent controls produce stable, bounded observations                                      | NOT RUN |                                                      |
|  19 | Simulate or observe response-content timeout; metadata remains and error code is `response-content-timeout` | NOT RUN |                                                      |
|  20 | Stop shows `stopping`, drains in-flight requests, and reports completed/timed-out/discarded counts          | NOT RUN |                                                      |
|  21 | Project/account/workflow switching and new recording are blocked while draining                             | NOT RUN |                                                      |
|  22 | No request is captured after stop finalizes                                                                 | NOT RUN |                                                      |
|  23 | Export initiates a sanitized JSON download and shows expected filename, exact byte size, and SHA-256        | NOT RUN |                                                      |
|  24 | Independently hash the saved file and compare it with the displayed SHA-256                                 | NOT RUN | Do not mark PASS if the file was not actually saved. |
|  25 | Purge remains separate, shows counts, requires the exact project name, and warns that it cannot be undone   | NOT RUN |                                                      |
|  26 | Cancelled/failed export does not invoke purge                                                               | NOT RUN |                                                      |
|  27 | Reload Chrome and confirm retained project/workflow evidence is still present                               | NOT RUN |                                                      |
|  28 | Remove the unpacked extension and stop both demo servers                                                    | NOT RUN |                                                      |

## Completion decision

- Overall manual result: **NOT RUN**
- Phase 3 gate: **BLOCKED until all required checks pass, CI succeeds, and this record contains real metadata and results.**

Screenshots must contain only the localhost harness and synthetic StateLens records.
