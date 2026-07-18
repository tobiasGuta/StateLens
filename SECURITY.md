# StateLens Security Policy

StateLens handles sensitive application traffic. Its security model prioritizes explicit authorization scope, data minimization, local-only processing, deterministic safeguards, and honest capture limitations.

## Supported versions

Until the first stable release, security fixes are applied to the latest commit on the default development branch. Published support ranges will be documented with the first tagged release.

## Report a vulnerability

Do not include real target traffic, credentials, tokens, private program data, or unnecessary personal information in a report. Open a private security advisory in the hosting repository when available, or contact the maintainers through the repository's designated security contact. Include a minimal synthetic reproduction using reserved example domains.

Do not open a public issue for a vulnerability that could expose user evidence.

## Trust boundaries

StateLens trusts the user to configure authorized scope and protect their browser profile. It does not trust:

- request URLs, headers, bodies, MIME types, timing, or HAR-like metadata from a target;
- response JSON, text, HTML, filenames, or redirects from a target;
- records read back from IndexedDB;
- filenames or notes supplied by a user;
- exported files after they leave the extension;
- other software running with access to the same browser profile or operating-system account.

## Threat model and controls

### Malicious target returns hostile JSON or HTML

Targets may return script-bearing strings, HTML, prototype-pollution keys, cyclic structures, extreme depth, or enormous objects. StateLens never injects captured HTML and relies on React text escaping. Parsed data is rendered through text-only JSON serialization. `__proto__`, `prototype`, and `constructor` keys are rejected or removed. JSON depth and key counts are bounded.

### Sensitive data leaks through logs

Production capture code does not log bodies, headers, or URLs to the console. Capture errors contain operational messages rather than raw body content. Contributors must not add diagnostic logging around captured traffic.

### Another extension or local process inspects StateLens data

IndexedDB is isolated to the extension origin, but a sufficiently privileged extension, compromised browser, local debugger, malware, browser-profile backup, or operating-system account may expose data. StateLens is not a hardened secret vault. Use a dedicated testing profile, minimize retention, and purge completed projects.

### Excessive browser-storage use

Default limits are 512 KB per request body, 1 MB per response body, JSON depth 30, 10,000 keys, 5,000 observations per workflow, and a 250 MB project warning threshold. Safe ceilings prevent unbounded configuration. Omitted content retains metadata and a hash when practical.

### Accidental out-of-scope collection

Recording cannot start without an enabled rule. Exact-host and subdomain matching use parsed hostname label boundaries, not string suffixes. URL-prefix matching pins scheme, effective port, origin, and a path boundary. Scope is checked before `getContent`; redirects to a nonmatching host are flagged. StateLens never expands scope automatically.

The parser preserves whether a port was explicitly supplied before the browser `URL` implementation normalizes it away. Scheme-only host rules do not pin a port, while `https://host:443`, `http://host:80`, and non-default explicit ports require the exact effective request port. DNS names, localhost, IPv4, and bracketed IPv6 are parsed without userinfo, path, query, or fragment ambiguity.

### Duplicate traffic suppression hides evidence

Semantic deduplication can conceal retries, repeated submissions, or concurrent operations with identical visible HAR values. StateLens therefore suppresses only repeated delivery of the exact same Chrome event object within one recording session. Separate objects are retained, assigned monotonic session sequence numbers, and each consumes observation capacity.

### Interrupted capture and finalization failure

The collector stops before workflow finalization. Finalization atomically reloads the stored workflow, reconciles observation IDs from the observation store, ends open markers, and writes completion. A failed transaction leaves the stored recording state intact and puts the UI into a blocking recovery state with the original context, drain summary, marker context, and error.

On startup, recording workflows without a live collector are treated as interrupted and never resumed automatically. Finalizing an interruption records local recovery metadata. Non-empty interrupted workflows cannot be casually deleted, and purge remains blocked while unresolved recording evidence exists.

### Exporting unredacted credentials

Headers and structured values are redacted before persistence. Query token fields are replaced. A final recursive redaction pass runs during JSON export and removes the project HMAC salt. Filenames are normalized and restricted to safe characters. The MVP deliberately has no raw-secret reveal or unredacted export path.

StateLens hashes the exact sanitized UTF-8 export bytes before initiating the browser download and reports the expected filename and byte size. It does not claim that the browser saved the file. Purge is a separate destructive action with displayed record counts, exact-name entry, and final confirmation; it never assumes an export is a backup.

### Custom regular-expression denial of service

Custom redaction patterns are bounded in count and length, must compile locally, and are conservatively rejected when they contain nested quantifiers. They operate only on already size-bounded captured content. If corrupted legacy custom settings are encountered, built-in redaction continues and invalid settings fail Zod validation rather than being persisted as valid data.

### Malformed HAR or DevTools data

The collector validates the minimum runtime shape before normalization. Missing values receive conservative defaults. Parse and response-content failures become explicit capture errors; they are not swallowed and do not crash the recorder.

### Deep JSON, large responses, and binary content

Byte length is checked before parsing. Excess bodies are omitted and hashed. Base64 and unsupported/binary MIME types are not interpreted as text. Deep or excessively wide JSON is omitted with a recoverable error. Multipart processing stores field and file metadata, not uploaded file bytes.

### Corrupted IndexedDB data

Records are checked with strict Zod schemas on read. Invalid records are isolated from normal UI data and produce a recoverable error record with store name, record ID when available, validation message, and detection time. Invalid data is not silently treated as valid.

### Unsafe code execution and request mutation

The Manifest V3 content-security policy permits only packaged scripts and disables objects and base-URI changes. StateLens uses no `eval`, dynamic code generation, remote script, content script, debugger permission, or target-request API. It never replays or modifies a request.

StateLens-owned source is scanned separately from generated dependency code. The production build does not rewrite React or other vendor chunks. Distribution verification checks manifest permissions, CSP, packaged assets, HTML/CSS resource references, source maps, and unexpected remote URLs. Its allowlist contains only documented inert React documentation strings and W3C/JSON-Schema namespace identifiers; it does not allow those hosts as executable resource sources.

## Secure development practices

- Strict TypeScript and runtime validation at trust boundaries
- Deterministic, pure scope and redaction helpers
- Small, separated capture, security, storage, export, and UI modules
- Automated scope, redaction, parsing, normalization, storage, rollback, purge, and component tests
- Required formatting, lint, type-check, test, and production-build gates
- Dependency audit during installation and review of Manifest permissions before release
- Synthetic fixtures and reserved example domains only

## Sensitive-data handling for contributors

Never commit real HAR files, target URLs, customer data, credentials, screenshots containing private programs, or copied browser storage. New fixtures must use `.test`, `.example`, or `.invalid` names and obviously synthetic values. Security-sensitive changes require tests for both expected behavior and bypass attempts.
