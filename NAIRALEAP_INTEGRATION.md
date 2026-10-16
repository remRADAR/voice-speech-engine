# NairaLeap Integration — Voice & Speech Engine

## Status and scope

This branch documents the intended boundary; it does not modify the speech library or add it as a NairaLeap dependency. NairaLeap's current integration branch is `remRADAR/NairaLeap:integration/nairaleap-plugin-vibe`. LeapBot already exposes an explicit-click browser `speechSynthesis` read-aloud action. The integration adds a visible disclosure that speech is provided by the browser/device, behavior varies, and the control does not request microphone access or enroll a voice.

No voice commands, microphone capture, recording, enrollment, speech-provider integration, or audio storage are added. The disclosure does not claim speech is offline or that text cannot be processed outside the device.

## Plugin API and provider requirements

The package defines `SpeechProvider`, `SynthesisHandle`, stream cancellation, and session capability interfaces. Its `SyntheticTestProvider` emits deterministic placeholder bytes derived from text; it explicitly does not synthesize real speech and is for tests/demos only. It must not be described or deployed as a speech product.

Before a real integration, select and review a real provider, test cancellation/timeouts/cleanup/concurrency, preserve user-initiated playback, and assess the provider's privacy and data-processing terms. Keep `enrollVoice` false unless explicit owner authorization and provider-compliant consent exist. Caller-supplied consent identifiers alone are not proof of consent.

## Configuration and fallback

No new environment variables, provider credentials, microphone permissions, or network calls are introduced by this UI disclosure. If browser speech is unsupported, keep text conversation/navigation usable and omit only read-aloud. Do not enable voice commands, enrollment, or recording without a separately approved consent, identity, retention/deletion, and authorization design.

## Verification

NairaLeap's focused Cypress spec verifies the read-aloud button is associated with the visible disclosure when browser speech is available. No device-specific speech output, microphone, recording, consent workflow, real provider, or audio transport was tested.

## CI and lockfile prerequisite

This stacked documentation PR targets `audit/stage-2-quality-gates`, which carries the committed `package-lock.json`. The quality-gate workflow now includes that base branch as a pull-request target so a fresh `npm ci` verification can run against the lockfile.
