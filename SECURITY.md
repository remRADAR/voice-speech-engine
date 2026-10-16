# Security policy

- Report vulnerabilities via GitHub Security Advisories — not issues.
- Real voice enrollment requires explicit owner authorization AND provider-compliant consent; the engine refuses enrolled profiles without a consent record and performs no enrollment, no recording uploads, and no paid service activation itself.
- Providers receive session capabilities; never extend provider trust beyond what the session authorizes.
- Never commit recordings, credentials, or provider keys. Keys live in host config, not in this repo.
- Conversation AI is an independent, replaceable capability; do not couple it to synthesis logic.
