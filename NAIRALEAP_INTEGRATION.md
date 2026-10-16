# NairaLeap Integration — Voice & Speech Engine

## Status and scope

This branch documents the intended boundary; it does not add the package as a NairaLeap runtime dependency. LeapBot retains its existing explicit-click browser `speechSynthesis` read-aloud action and visible device/browser speech disclosure. This is not the plugin provider and does not request microphone access or enroll a voice.

No voice commands, microphone capture, recording, provider integration, enrollment, or audio storage are added. The UI does not claim speech is offline or that text cannot be processed outside the device.

## Plugin API and provider requirements

- `SessionManager` returns frozen snapshots. `isAuthorizedSynthesisSession()` accepts only an unmodified manager-issued snapshot with synthesis enabled. `PlaybackQueue` rejects structurally forged/disabled sessions before calling a provider; real provider adapters must enforce this authorization contract too.
- Every `SpeechProvider` declares `isPlaceholder`; `PlaybackQueue` checks each handle's `providerId` and `placeholder` fields against that declaration. This catches inconsistent labels but does not make a malicious adapter trustworthy. `SyntheticTestProvider` emits deterministic placeholder bytes with `providerId: "synthetic-test"` and `placeholder: true`; it is not real speech and must never be presented as a production voice service.
- Queue transitions are serialized. A prior handle remains tracked until cancellation is confirmed; a late result from aborted startup is cancelled before a successor may start. If an aborted startup remains unresolved, `stop()` reports that it cannot confirm quiescence and subsequent requests remain blocked until cleanup completes. If handle cancellation is unconfirmed, that queue instance fails closed.
- Voice enrollment remains off by default and requires a host-supplied `ConsentValidator` backed by trusted provider-compliant consent records. Caller-supplied IDs alone are not proof of consent.

Before real integration, select and review a provider, test cancellation/timeouts/cleanup/concurrency against it, preserve user-initiated playback, and assess its privacy/data-processing terms. No real recordings or provider calls were used for these tests.

## Configuration, fallback, and verification

No new environment variables, provider credentials, microphone permissions, or network calls are introduced by the UI disclosure. If browser speech is unsupported, leave text/navigation usable and omit read-aloud. Do not enable commands, enrollment, or recording without separately approved consent, identity, retention/deletion, and authorization design.

The focused NairaLeap Cypress spec verifies the browser/device disclosure. Package tests cover synthetic output labeling, session forgery rejection, provider/handle provenance mismatch, stream lifecycle, startup cancellation, late-handle cleanup, concurrent request serialization, and stop/quiescence reporting; no device-specific real TTS output or production provider was tested.

This stacked documentation PR targets `audit/stage-2-quality-gates`, which carries `package-lock.json`; CI includes that base as a pull-request target so `npm ci` can run. The quality-gate PR remains a prerequisite before this documentation PR can be retargeted to `main`.
