import { describe, it, expect } from "vitest";
import { SessionManager, VoiceRegistry } from "../src/session.js";

describe("SessionManager (authorization)", () => {
  it("defaults: synthesis only — enrollment and conversation AI off", () => {
    const mgr = new SessionManager();
    const s = mgr.create("s1", "user-1");
    expect(s.capabilities.synthesize).toBe(true);
    expect(s.capabilities.enrollVoice).toBe(false);
    expect(s.capabilities.useConversationAi).toBe(false);
  });

  it("cannot enable enrollment without consent record and authorizer", () => {
    const mgr = new SessionManager();
    mgr.create("s2", "user-2");
    expect(() => mgr.authorizeEnrollment("s2", "", "owner")).toThrow();
    expect(() => mgr.authorizeEnrollment("s2", "consent-1", "")).toThrow();
    expect(mgr.can("s2", "enrollVoice")).toBe(false);
  });

  it("explicit recorded authorization enables enrollment capability", () => {
    const mgr = new SessionManager();
    mgr.create("s3", "user-3");
    mgr.authorizeEnrollment("s3", "consent-123", "owner-1");
    expect(mgr.can("s3", "enrollVoice")).toBe(true);
  });

  it("validates ids and rejects duplicates", () => {
    const mgr = new SessionManager();
    mgr.create("s4", "user-4");
    expect(() => mgr.create("s4", "user-4")).toThrow();
    expect(() => mgr.create("", "user")).toThrow();
  });
});

describe("VoiceRegistry (consent safeguards)", () => {
  it("accepts synthetic and licensed profiles without consent records", () => {
    const reg = new VoiceRegistry();
    reg.add({ id: "v-syn", kind: "synthetic", label: "Test Synthetic" });
    reg.add({ id: "v-lic", kind: "licensed", label: "Licensed Demo" });
    expect(reg.list()).toHaveLength(2);
  });

  it("refuses enrolled profiles without a provider-compliant consent record", () => {
    const reg = new VoiceRegistry();
    expect(() => reg.add({ id: "v-bad", kind: "enrolled", label: "No consent" })).toThrow(/consentRecordId/i);
    reg.add({ id: "v-ok", kind: "enrolled", label: "Consented", consentRecordId: "consent-1" });
    expect(reg.get("v-ok")?.consentRecordId).toBe("consent-1");
  });
});
