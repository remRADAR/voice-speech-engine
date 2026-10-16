# HANDOFF TO MANUS — voice-speech-engine

## Repository URL and branch/commit

- Repository: https://github.com/remRADAR/voice-speech-engine
- Branch: `main`. Initial implementation pushed as the first code commit on top of the README-only init commit. Record the exact commit SHA here after auditing.
- Note: repository was created manually by the owner (the build integration could not create repositories; `403 Resource not accessible by integration`).

## Implemented modules

- `src/streaming.ts` — `ChunkOrderingBuffer` (strict seq validation), `chunkText`.
- `src/pronunciation.ts` — `PronunciationLexicon`: locale-scoped rules, longest-match-first, data-driven (safe to load packs).
- `src/session.ts` — `SessionManager` (synthesize-only defaults; `authorizeEnrollment` requires consent record + authorizer identity), `VoiceRegistry` (refuses enrolled profiles without consent).
- `src/synthesize.ts` — `SpeechProvider`/`SynthesisHandle` contracts; `SyntheticTestProvider` (offline deterministic placeholder — NOT real TTS); `PlaybackQueue` (cancel-before-start interruption); `collectOrdered` (order-validating consumer).
- `src/adapters/react.ts` — placeholder, NOT IMPLEMENTED.

## Commands

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

## Actual test results

- Tests authored (vitest: ordering, cancellation idempotence, interruption, session authz, consent gating, pronunciation) but **not executed in the authoring environment — no Node runtime was available**. First authoritative results come from CI on first push.
- Concurrency note: the cancellation/interruption tests use async timing; if flaky in CI, verify with `vitest run --reporter=verbose` before changing assertions — do not delete the assertions to get a green run.
- `npm run lint` requires ESLint config which is NOT yet present (outstanding work); the lint step may fail in CI until a config is added.

## Environment variables / provider prerequisites

- None for core + synthetic provider. A real TTS provider adapter will need vendor credentials via host config — never in this repo.

## Database schemas and migrations

- None. Session persistence adapters (optional Neon/Supabase) must derive schema from actual host inspection and never modify host production schemas without separate authorization.

## Security assumptions and known risks

- No real voice enrollment path exists or can exist here without explicit owner authorization + provider-compliant consent; `VoiceRegistry` refuses enrolled profiles lacking consent records. No recordings uploaded, no paid services activated.
- `SyntheticTestProvider` output is placeholder bytes — never treat as production audio or claim voice quality from it.
- Session manager has no authentication of its own; the host owns identity. Adapter phase must bind sessions to host auth.
- Conversation AI integration is a capability flag only — deliberately not coupled.

## Mocked or incomplete features

- Synthetic provider (mock by design), React adapter, database adapters, real TTS provider adapters, pronunciation rule packs for real languages (need vetted linguistic data), ESLint config.

## Known bugs / prioritized outstanding work

1. Run CI for authoritative test results (first reviewer action); add ESLint config.
2. Vet a real speech provider and build its adapter behind `SpeechProvider` (needs owner selection; treat vendor claims skeptically).
3. React adapter (`SpeechProviderContext`, `useSpeech`).
4. Session persistence + host auth binding (optional Neon/Supabase adapters).
5. Pronunciation rule packs for verified languages from nigerian-language-engine (do not machine-generate linguistic data).
6. Shared GitHub Project board (blocked: no Projects capability in current integration).

## Reproduction for the independent reviewer

```bash
git clone https://github.com/remRADAR/voice-speech-engine.git
cd voice-speech-engine
npm ci && npm run lint && npm run typecheck && npm test && npm run build
```

Cross-repository dependencies: nigerian-language-engine (locale data drives pronunciation scoping; verified languages only), article-intelligence-discussion (read-aloud of approved content must respect the same editorial approval gates).
