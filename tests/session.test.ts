import { describe, it, expect } from "vitest";
import { SessionManager, VoiceRegistry } from "../src/session.js";
import type { ConsentValidationRequest, ConsentValidator } from "../src/types.js";

describe("SessionManager (authorization)", () => {
  it("defaults to synthesis only and ignores an enrollment override", () => {
    const manager = new SessionManager();
    const session = manager.create("s1", "user-1", { enrollVoice: true });
    expect(session.capabilities.synthesize).toBe(true);
    expect(session.capabilities.enrollVoice).toBe(false);
    expect(session.capabilities.useConversationAi).toBe(false);
    expect(manager.can("s1", "enrollVoice")).toBe(false);
  });

  it("requires a configured trusted consent validator before enrollment", () => {
    const manager = new SessionManager();
    manager.create("s2", "user-2");
    expect(() => manager.authorizeEnrollment("s2", "consent-123", "owner")).toThrow(/no trusted consent validator/);
    expect(manager.can("s2", "enrollVoice")).toBe(false);
  });

  it("rejects consent the configured validator cannot verify", () => {
    const manager = new SessionManager({ validateConsent: () => false });
    manager.create("s3", "user-3");
    expect(() => manager.authorizeEnrollment("s3", "consent-123", "owner")).toThrow(/not validated/);
    expect(manager.can("s3", "enrollVoice")).toBe(false);
  });

  it("enables enrollment only after explicit host validation tied to the session subject", () => {
    const requests: ConsentValidationRequest[] = [];
    const validator: ConsentValidator = {
      validateConsent(input) {
        requests.push(input);
        return input.consentRecordId === "consent-123" && input.subjectId === "user-4";
      },
    };
    const manager = new SessionManager(validator);
    manager.create("s4", "user-4");
    const authorized = manager.authorizeEnrollment("s4", "consent-123", "owner-1");
    expect(authorized.capabilities.enrollVoice).toBe(true);
    expect(manager.can("s4", "enrollVoice")).toBe(true);
    expect(requests).toEqual([
      {
        consentRecordId: "consent-123",
        action: "authorize-enrollment",
        subjectId: "user-4",
        authorizedBy: "owner-1",
      },
    ]);
  });

  it("returns deeply frozen snapshots so callers cannot escalate session capabilities", () => {
    const manager = new SessionManager();
    const session = manager.create("s5", "user-5", { synthesize: false });
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session.capabilities)).toBe(true);
    const mutable = session as unknown as { capabilities: { synthesize: boolean; enrollVoice: boolean } };
    expect(() => {
      mutable.capabilities.synthesize = true;
    }).toThrow();
    const fetched = manager.get("s5");
    expect(fetched?.capabilities.synthesize).toBe(false);
    expect(manager.can("s5", "enrollVoice")).toBe(false);
    expect(manager.can("s5", "synthesize")).toBe(false);
  });

  it("validates ids and rejects duplicates", () => {
    const manager = new SessionManager();
    manager.create("s6", "user-6");
    expect(() => manager.create("s6", "user-6")).toThrow();
    expect(() => manager.create("", "user")).toThrow();
  });
});

describe("VoiceRegistry (consent safeguards)", () => {
  it("accepts synthetic and licensed profiles without consent records", () => {
    const registry = new VoiceRegistry();
    registry.add({ id: "v-syn", kind: "synthetic", label: "Test Synthetic" });
    registry.add({ id: "v-lic", kind: "licensed", label: "Licensed Demo" });
    expect(registry.list()).toHaveLength(2);
  });

  it("refuses enrolled profiles when a consent record or validator is missing", () => {
    const registry = new VoiceRegistry();
    expect(() => registry.add({ id: "v-bad", kind: "enrolled", label: "No consent" })).toThrow(/consentRecordId/i);
    expect(() => registry.add({ id: "v-no-validator", kind: "enrolled", label: "Consent", consentRecordId: "consent-123" })).toThrow(/no trusted consent validator/);
  });

  it("rejects invalid host validation and accepts only validated records", () => {
    const rejecting = new VoiceRegistry({ validateConsent: () => false });
    expect(() => rejecting.add({ id: "v-rejected", kind: "enrolled", label: "Rejected", consentRecordId: "consent-123" })).toThrow(/not validated/);

    const validatedRequests: ConsentValidationRequest[] = [];
    const validator: ConsentValidator = {
      validateConsent(input) {
        validatedRequests.push(input);
        return input.consentRecordId === "consent-123" && input.voiceProfileId === "v-ok";
      },
    };
    const registry = new VoiceRegistry(validator);
    registry.add({ id: "v-ok", kind: "enrolled", label: "Consented", consentRecordId: "consent-123" });
    expect(registry.get("v-ok")?.consentRecordId).toBe("consent-123");
    expect(validatedRequests[0]).toMatchObject({
      consentRecordId: "consent-123",
      action: "register-enrolled-profile",
      voiceProfileId: "v-ok",
    });
  });

  it("returns defensive copies and rejects duplicate profile ids", () => {
    const registry = new VoiceRegistry();
    const profile = { id: "v1", kind: "synthetic" as const, label: "Synthetic" };
    registry.add(profile);
    profile.label = "mutated";
    const returned = registry.get("v1");
    if (returned) returned.label = "returned mutation";
    expect(registry.get("v1")?.label).toBe("Synthetic");
    expect(() => registry.add({ id: "v1", kind: "synthetic", label: "duplicate" })).toThrow(/Duplicate/);
  });
});
