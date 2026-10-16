# voice-speech-engine

Provider-independent voice and speech synthesis engine: streaming abstractions, cancellation/interruption, pronunciation rules, session management with consent safeguards. TypeScript.

## Status: ALPHA — first implementation pass (awaiting independent audit)

See `HANDOFF_TO_MANUS.md`.

## Design rules

- **Provider independence.** Domain logic speaks only to the `SpeechProvider` interface; vendors are replaceable adapters.
- **Synthetic by default.** The bundled `SyntheticTestProvider` is an offline deterministic placeholder — it is NOT real speech synthesis and must never be described as a voice product.
- **Consent safeguards.** Voice enrollment is OFF by default; enabling it requires an explicit recorded authorization with a provider-compliant consent record. Enrolled voice profiles without a consent record are rejected. This engine performs no enrollment itself, uploads no recordings, and activates no paid services.
- **Conversation AI is independent.** `useConversationAi` is a separate capability, off by default, never coupled to synthesis.
- **Streaming integrity.** `ChunkOrderingBuffer` rejects gaps/repeats/out-of-order chunks; `PlaybackQueue.interruptWith()` cancels the in-flight utterance before starting a new one — no overlapping audio.

## Modules

| Module | Status |
| --- | --- |
| `streaming` (ordering buffer, text chunker) | Implemented, tested |
| `pronunciation` (locale-scoped lexicon, longest-match-first) | Implemented, tested |
| `session` (authorization, capabilities, voice registry consent checks) | Implemented, tested |
| `synthesize` (provider interface, offline synthetic provider, playback queue, ordered collection) | Implemented, tested |
| `adapters/react` | NOT IMPLEMENTED (planned) |
| database adapters (Neon/Supabase, session persistence) | NOT IMPLEMENTED (planned) |

## Development

```bash
npm ci && npm test && npm run typecheck && npm run build
```

## License

MIT.
