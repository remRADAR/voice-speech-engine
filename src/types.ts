/** Ordered audio chunk from a synthesis stream. */
export interface AudioChunk {
  /** Sequence number; consumers must reject gaps/repeats. */
  seq: number;
  /** Audio bytes (format per session config). */
  data: Uint8Array;
  /** True on exactly the final chunk of a normally completed utterance. */
  final: boolean;
}

export interface SpeechRequest {
  text: string;
  /** Locale for pronunciation, e.g. "yo", "en-NG". */
  locale?: string;
  voiceId?: string;
}

/**
 * Replaceable speech-synthesis provider. Domain logic must never couple to a
 * concrete vendor. Implementations should observe the optional AbortSignal;
 * returned handles must support idempotent cancellation and must not require
 * server-side secrets in the browser. Providers must check manager-issued
 * session authorization before producing audio.
 */
export interface SpeechProvider {
  readonly id: string;
  /** Provider-declared provenance; queue verifies this against every returned handle. */
  readonly isPlaceholder: boolean;
  /** True only if the provider supports streamed chunk delivery. */
  readonly supportsStreaming: boolean;
  synthesize(
    request: SpeechRequest,
    session: SpeechSession,
    options?: { signal?: AbortSignal },
  ): Promise<SynthesisHandle>;
}

export interface SynthesisHandle {
  /** Runtime provenance carried to all consumers; synthetic bytes are visibly placeholders. */
  readonly providerId: string;
  readonly placeholder: boolean;
  /** Stream of ordered chunks; normal completion must include a final chunk. */
  stream: AsyncIterable<AudioChunk>;
  /** Immediately stop synthesis and end the stream. Idempotent. */
  cancel(): Promise<void>;
}

export interface SpeechSession {
  readonly id: string;
  /** Subject of the session — a user ID or "anonymous". */
  readonly subject: string;
  /** Frozen capabilities from a SessionManager-issued snapshot. */
  readonly capabilities: Readonly<SessionCapabilities>;
  readonly createdAt: string;
}

export interface SessionCapabilities {
  readonly synthesize: boolean;
  /** Real voice enrollment — false unless a configured validator verifies consent. */
  readonly enrollVoice: boolean;
  /** Conversation AI integration — independently replaceable, off by default. */
  readonly useConversationAi: boolean;
}

export interface ConsentValidationRequest {
  consentRecordId: string;
  action: "authorize-enrollment" | "register-enrolled-profile";
  subjectId?: string;
  authorizedBy?: string;
  voiceProfileId?: string;
}

/** The host must implement this against its trusted, provider-compliant consent records. */
export interface ConsentValidator {
  validateConsent(input: ConsentValidationRequest): boolean;
}

export interface PronunciationRule {
  /** Orthographic pattern (plain substring match). */
  grapheme: string;
  /** Phonemic respelling or IPA. */
  phoneme: string;
  locale?: string;
}

export interface VoiceProfile {
  id: string;
  /** "synthetic" | "licensed" | "enrolled". Enrolled requires validated consent. */
  kind: "synthetic" | "licensed" | "enrolled";
  label: string;
  locale?: string;
  /** Required for enrolled voices; must reference provider-compliant consent. */
  consentRecordId?: string;
}
