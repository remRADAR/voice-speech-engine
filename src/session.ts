import type { SessionCapabilities, SpeechSession, VoiceProfile } from "./types.js";

/**
 * Session management with authorization. Default capabilities are
 * synthesize-only: voice enrollment and conversation AI stay OFF absent
 * explicit, recorded authorization. There is deliberately no path here that
 * can enroll a real person's voice.
 */
export class SessionManager {
  private sessions = new Map<string, SpeechSession>();

  create(id: string, subject: string, overrides: Partial<SessionCapabilities> = {}): SpeechSession {
    if (!id?.trim() || !subject?.trim()) throw new Error("Session id and subject required");
    if (this.sessions.has(id)) throw new Error(`Duplicate session: ${id}`);
    const session: SpeechSession = {
      id,
      subject,
      createdAt: new Date().toISOString(),
      capabilities: {
        synthesize: overrides.synthesize ?? true,
        enrollVoice: false, // hard default; see authorizeEnrollment
        useConversationAi: overrides.useConversationAi ?? false,
      },
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): SpeechSession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Enrollment can only be enabled by an explicit, recorded authorization
   * (owner approval + provider-compliant consent record id). This engine never
   * performs enrollment itself; a provider adapter must re-check consent.
   */
  authorizeEnrollment(sessionId: string, consentRecordId: string, authorizedBy: string): SpeechSession {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Unknown session: ${sessionId}`);
    if (!consentRecordId?.trim() || !authorizedBy?.trim()) {
      throw new Error("Voice enrollment requires a consent record and authorizer identity");
    }
    s.capabilities.enrollVoice = true;
    return s;
  }

  can(sessionId: string, capability: keyof SessionCapabilities): boolean {
    return this.sessions.get(sessionId)?.capabilities[capability] === true;
  }
}

/** Registry of voice profiles. Enrolled profiles are refused without a consent record. */
export class VoiceRegistry {
  private profiles = new Map<string, VoiceProfile>();

  add(profile: VoiceProfile): void {
    if (profile.kind === "enrolled" && !profile.consentRecordId) {
      throw new Error("Enrolled voice profiles require a consentRecordId");
    }
    this.profiles.set(profile.id, profile);
  }

  list(kind?: VoiceProfile["kind"]): VoiceProfile[] {
    return [...this.profiles.values()].filter((p) => !kind || p.kind === kind);
  }

  get(id: string): VoiceProfile | undefined {
    return this.profiles.get(id);
  }
}
