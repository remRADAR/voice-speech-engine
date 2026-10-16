# voice-speech-engine

Provider-independent voice and speech synthesis abstractions: streaming lifecycle, cancellation/interruption, pronunciation helpers, and consent-gated session/profile contracts. TypeScript ESM.

## Status: ALPHA — synthetic provider only; not a production speech service

See `HANDOFF_TO_MANUS.md` and `NAIRALEAP_INTEGRATION.md`.

## Design and security boundaries

- **Provider independence.** Domain logic speaks only to the `SpeechProvider` interface; vendor adapters remain replaceable and must enforce the manager-issued session authorization contract. Each adapter declares whether it emits placeholders; the queue checks every handle's provider ID and placeholder flag against that declaration. This consistency check does not make a malicious provider trustworthy.
- **Manager-issued sessions only.** `SessionManager` returns frozen snapshots. `isAuthorizedSynthesisSession()` checks runtime membership in the manager-issued snapshot set and the synthesis capability; a structurally forged or mutated session is rejected.
- **Synthetic placeholder by default.** `SyntheticTestProvider` is offline deterministic test/demo output, not real speech. Its returned handle includes `providerId: "synthetic-test"` and `placeholder: true`; consumers must preserve this label. The queue rejects handle metadata that conflicts with the configured provider's declaration.
- **Consent safeguards.** Voice enrollment is off by default; enabling the capability or registering an enrolled profile requires a host-supplied validator backed by trusted consent records. This package performs no recording, upload, enrollment, persistence, or paid-provider activation.
- **Independent capabilities.** Conversation AI remains separate from speech synthesis and is off by default.
- **Serialized, bounded lifecycle.** Queue transitions are serialized. A previous handle remains tracked until cancellation is confirmed; a late handle from aborted startup is cancelled before any successor can start. If startup remains unresolved, stop reports failure and later starts remain blocked until cleanup completes. Unconfirmed handle cancellation permanently blocks that queue instance rather than risking overlapping or mislabeled audio. The host should show that speech is unavailable and offer a safe retry with a newly created queue only after provider cleanup is understood.
- **Streaming integrity.** `collectOrdered()` rejects gaps, repeated/out-of-order chunks, data after the final marker, and normal completion without exactly a final marker.

## Modules

| Module | Status |
| --- | --- |
| `streaming` (ordering buffer, text chunker) | Implemented and tested |
| `pronunciation` (locale-scoped lexicon, longest-match-first) | Implemented and tested |
| `session` (frozen authorization snapshots, consent validator) | Implemented and tested |
| `synthesize` (provider interface, offline placeholder, bounded queue/cleanup) | Implemented and tested |
| React / database adapters and production TTS providers | Not implemented |

## Development

Runtime source targets Node.js 18+, but the current development/test toolchain (Vitest 4 and ESLint 10) requires Node.js 20.19+; CI uses Node 20.

```bash
npm ci
npm audit --audit-level=moderate
npm run lint
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

The package metadata currently declares MIT. Confirm that license choice with the owner before any package publication. No package was published as part of this work.
