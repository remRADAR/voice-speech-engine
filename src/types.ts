/** Ordered audio chunk from a synthesis stream. */
export interface AudioChunk {
  /** Sequence number; consumers must reject gaps/repeats. */
  seq: number;
  /** Audio bytes (format per session config). */
  data: Uint8Array;
  /** True on the final chunk of an utterance. */
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
 * concrete vendor. Implementations must support cancellation via the returned
 * controller and must not require server-side secrets in the browser.
 */
export interface SpeechProvider {
  readonly id: string;
  /** True only if the provider supports streamed chunk delivery. */
  readonly supportsStreaming: boolean;
  synthesize(request: SpeechRequest, session: SpeechSession): Promise<SynthesisHandle>;
}

export interface SynthesisHandle {
  /** Stream of ordered chunks for this utterance. */
  stream: AsyncIterable<AudioChunk>;
  /** Immediately stop synthesis and end the stream. Idempotent. */
  cancel(): Promise<void>;
}

export interface SpeechSession {
  readonly id: string;
  /** Subject of the session — a user ID or "anonymous". */
  subject: string;
  /** Capabilities granted to this session. */
  capabilities: SessionCapabilities;
  createdAt: string;
}

export interface SessionCapabilities {
  synthesize: boolean;
  /** Real voice enrollment — must be false unless explicit owner authorization AND provider-compliant consent exist. */
  enrollVoice: boolean;
  /** Conversation AI integration — independently replaceable, off by default. */
  useConversationAi: boolean;
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
  /** "synthetic" | "licensed" | "enrolled". Enrolled requires explicit consent records. */
  kind: "synthetic" | "licensed" | "enrolled";
  label: string;
  locale?: string;
  /** Required for enrolled voices; must reference provider-compliant consent. */
  consentRecordId?: string;
}
