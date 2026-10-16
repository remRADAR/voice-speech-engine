import type {
  ConsentValidator,
  SessionCapabilities,
  SpeechSession,
  VoiceProfile,
} from "./types.js";

type MutableSession = {
  id: string;
  subject: string;
  createdAt: string;
  capabilities: {
    synthesize: boolean;
    enrollVoice: boolean;
    useConversationAi: boolean;
  };
};

const issuedSessions = new WeakSet<object>();

const issueSessionSnapshot = (session: MutableSession): SpeechSession => {
  const snapshot = Object.freeze({
    id: session.id,
    subject: session.subject,
    createdAt: session.createdAt,
    capabilities: Object.freeze({ ...session.capabilities }),
  });
  issuedSessions.add(snapshot);
  return snapshot;
};

/** Runtime provider check: a structurally forged session is never authorized. */
export function isAuthorizedSynthesisSession(session: SpeechSession): boolean {
  return (
    !!session &&
    typeof session === "object" &&
    issuedSessions.has(session as object) &&
    session.capabilities?.synthesize === true
  );
}

const cloneProfile = (profile: VoiceProfile): VoiceProfile => ({ ...profile });

/**
 * Session management with authorization. Default capabilities are
 * synthesize-only: voice enrollment and conversation AI stay OFF. Enrollment
 * requires a host-supplied validator backed by trusted consent records.
 */
export class SessionManager {
  private sessions = new Map<string, MutableSession>();

  constructor(private readonly consentValidator?: ConsentValidator) {}

  create(id: string, subject: string, overrides: Partial<SessionCapabilities> = {}): SpeechSession {
    if (!id?.trim() || !subject?.trim()) throw new Error("Session id and subject required");
    if (this.sessions.has(id)) throw new Error(`Duplicate session: ${id}`);
    const session: MutableSession = {
      id,
      subject,
      createdAt: new Date().toISOString(),
      capabilities: {
        synthesize: overrides.synthesize ?? true,
        enrollVoice: false, // never allow an override to bypass consent validation
        useConversationAi: overrides.useConversationAi ?? false,
      },
    };
    this.sessions.set(id, session);
    return issueSessionSnapshot(session);
  }

  get(id: string): SpeechSession | undefined {
    const session = this.sessions.get(id);
    return session ? issueSessionSnapshot(session) : undefined;
  }

  /** Consent is rejected by default; only a trusted host validator can authorize it. */
  authorizeEnrollment(sessionId: string, consentRecordId: string, authorizedBy: string): SpeechSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    if (!consentRecordId?.trim() || !authorizedBy?.trim()) {
      throw new Error("Voice enrollment requires a consent record and authorizer identity");
    }
    if (!this.consentValidator) {
      throw new Error("Voice enrollment is disabled because no trusted consent validator is configured");
    }
    const validated = this.consentValidator.validateConsent({
      consentRecordId: consentRecordId.trim(),
      action: "authorize-enrollment",
      subjectId: session.subject,
      authorizedBy: authorizedBy.trim(),
    });
    if (validated !== true) throw new Error("Consent record was not validated for this session");
    session.capabilities.enrollVoice = true;
    return issueSessionSnapshot(session);
  }

  can(sessionId: string, capability: keyof SessionCapabilities): boolean {
    return this.sessions.get(sessionId)?.capabilities[capability] === true;
  }
}

/** Registry of voice profiles; enrolled profiles require a trusted consent validator. */
export class VoiceRegistry {
  private profiles = new Map<string, VoiceProfile>();

  constructor(private readonly consentValidator?: ConsentValidator) {}

  add(profile: VoiceProfile): void {
    if (!profile.id?.trim() || !profile.label?.trim()) throw new Error("Voice profile id and label are required");
    if (this.profiles.has(profile.id)) throw new Error(`Duplicate voice profile: ${profile.id}`);
    if (profile.kind === "enrolled") {
      if (!profile.consentRecordId?.trim()) {
        throw new Error("Enrolled voice profiles require a consentRecordId");
      }
      if (!this.consentValidator) {
        throw new Error("Enrolled voice profiles are disabled because no trusted consent validator is configured");
      }
      const validated = this.consentValidator.validateConsent({
        consentRecordId: profile.consentRecordId.trim(),
        action: "register-enrolled-profile",
        voiceProfileId: profile.id,
      });
      if (validated !== true) throw new Error("Consent record was not validated for this voice profile");
    }
    this.profiles.set(profile.id, cloneProfile(profile));
  }

  list(kind?: VoiceProfile["kind"]): VoiceProfile[] {
    return [...this.profiles.values()]
      .filter((profile) => !kind || profile.kind === kind)
      .map(cloneProfile);
  }

  get(id: string): VoiceProfile | undefined {
    const profile = this.profiles.get(id);
    return profile ? cloneProfile(profile) : undefined;
  }
}
