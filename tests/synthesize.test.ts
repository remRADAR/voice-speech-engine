import { describe, it, expect } from "vitest";
import { SyntheticTestProvider, PlaybackQueue, collectOrdered } from "../src/synthesize.js";
import { SessionManager } from "../src/session.js";

describe("SyntheticTestProvider (offline, deterministic)", () => {
  it("streams strictly ordered chunks ending with final=true", async () => {
    const mgr = new SessionManager();
    const session = mgr.create("s1", "user-1");
    const provider = new SyntheticTestProvider();
    const handle = await provider.synthesize({ text: "one two three four five six seven eight nine ten" }, session);
    const chunks = await collectOrdered(handle);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[chunks.length - 1]?.final).toBe(true);
    expect(chunks.slice(0, -1).every((c) => !c.final)).toBe(true);
  });

  it("refuses synthesis for unauthorized sessions", async () => {
    const mgr = new SessionManager();
    const session = mgr.create("s2", "user-2", { synthesize: false });
    const provider = new SyntheticTestProvider();
    await expect(provider.synthesize({ text: "hi" }, session)).rejects.toThrow(/not authorized/i);
  });

  it("rejects empty text", async () => {
    const mgr = new SessionManager();
    const session = mgr.create("s3", "user-3");
    const provider = new SyntheticTestProvider();
    await expect(provider.synthesize({ text: "   " }, session)).rejects.toThrow(/Nothing to synthesize/i);
  });

  it("cancellation stops the stream immediately and is idempotent", async () => {
    const mgr = new SessionManager();
    const session = mgr.create("s4", "user-4");
    const provider = new SyntheticTestProvider();
    const handle = await provider.synthesize({ text: "word ".repeat(50).trim() }, session);
    const consumed: number[] = [];
    const reading = (async () => {
      for await (const c of handle.stream) consumed.push(c.seq);
    })();
    await new Promise((r) => setTimeout(r, 1));
    await handle.cancel();
    await handle.cancel(); // idempotent
    await reading;
    expect(consumed.length).toBeLessThan(50);
  });

  it("interruption cancels the previous handle before starting the next", async () => {
    const mgr = new SessionManager();
    const session = mgr.create("s5", "user-5");
    const provider = new SyntheticTestProvider();
    const queue = new PlaybackQueue();
    const first = await queue.interruptWith(provider, { text: "first " + "x ".repeat(30) }, session);
    const second = await queue.interruptWith(provider, { text: "second utterance" }, session);
    const chunks = await collectOrdered(second);
    const text = chunks.map((c) => new TextDecoder().decode(c.data)).join(" ");
    expect(text).toContain("second utterance");
    // Reading the cancelled first handle must simply end (no crash, no overlap).
    const firstChunks = await collectOrdered(first);
    expect(firstChunks.length).toBeLessThan(35);
  });
});
