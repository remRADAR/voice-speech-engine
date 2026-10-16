import { describe, it, expect } from "vitest";
import { SyntheticTestProvider, PlaybackQueue, collectOrdered } from "../src/synthesize.js";
import { SessionManager } from "../src/session.js";
import type { AudioChunk, SpeechProvider, SynthesisHandle } from "../src/types.js";

const makeHandle = (
  chunks: AudioChunk[],
  onCancel: () => void = () => {},
  providerId = "test-provider",
  placeholder = false,
): SynthesisHandle => ({
  providerId,
  placeholder,
  stream: {
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    },
  },
  async cancel() {
    onCancel();
  },
});

const chunk = (seq: number, final = false): AudioChunk => ({
  seq,
  data: new Uint8Array([seq]),
  final,
});

describe("SyntheticTestProvider (offline, deterministic)", () => {
  it("streams strictly ordered chunks ending with final=true and labels placeholder provenance", async () => {
    const manager = new SessionManager();
    const session = manager.create("s1", "user-1");
    const provider = new SyntheticTestProvider();
    const handle = await provider.synthesize(
      { text: "one two three four five six seven eight nine ten eleven twelve" },
      session,
    );
    expect(handle.providerId).toBe("synthetic-test");
    expect(handle.placeholder).toBe(true);
    const chunks = await collectOrdered(handle);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[chunks.length - 1]?.final).toBe(true);
    expect(chunks.slice(0, -1).every((item) => !item.final)).toBe(true);
  });

  it("refuses synthesis for unauthorized sessions", async () => {
    const manager = new SessionManager();
    const session = manager.create("s2", "user-2", { synthesize: false });
    await expect(new SyntheticTestProvider().synthesize({ text: "hi" }, session)).rejects.toThrow(/not authorized/i);
  });

  it("rejects a structurally forged session even when it claims synthesize=true", async () => {
    const forged = {
      id: "forged",
      subject: "attacker",
      createdAt: new Date().toISOString(),
      capabilities: { synthesize: true, enrollVoice: false, useConversationAi: false },
    } as const;
    await expect(new SyntheticTestProvider().synthesize({ text: "forged" }, forged)).rejects.toThrow(/not authorized/i);
  });

  it("rejects empty text", async () => {
    const manager = new SessionManager();
    const session = manager.create("s3", "user-3");
    await expect(new SyntheticTestProvider().synthesize({ text: "   " }, session)).rejects.toThrow(/Nothing to synthesize/i);
  });

  it("cancellation before playback starts ends the stream deterministically", async () => {
    const manager = new SessionManager();
    const session = manager.create("s4", "user-4");
    const handle = await new SyntheticTestProvider().synthesize({ text: "word ".repeat(50).trim() }, session);
    await handle.cancel();
    await expect(collectOrdered(handle)).rejects.toThrow(/without a final chunk/);
    await expect(handle.cancel()).resolves.toBeUndefined();
  });

  it("cancels the previous handle before starting a sequential interruption", async () => {
    const manager = new SessionManager();
    const session = manager.create("s5", "user-5");
    const provider = new SyntheticTestProvider();
    const queue = new PlaybackQueue();
    const first = await queue.interruptWith(provider, { text: "first " + "x ".repeat(30) }, session);
    const second = await queue.interruptWith(provider, { text: "second utterance" }, session);
    const chunks = await collectOrdered(second);
    const text = chunks.map((item) => new TextDecoder().decode(item.data)).join(" ");
    expect(text).toContain("second utterance");
    await expect(collectOrdered(first)).rejects.toThrow(/without a final chunk/);
  });

  it("rejects absent or non-streaming providers without fallback", async () => {
    const manager = new SessionManager();
    const session = manager.create("s6", "user-6");
    const queue = new PlaybackQueue();
    await expect(queue.interruptWith(undefined as unknown as SpeechProvider, { text: "hi" }, session)).rejects.toThrow(/unavailable/);
    const nonStreaming: SpeechProvider = {
      id: "non-streaming",
      isPlaceholder: false,
      supportsStreaming: false,
      async synthesize() {
        throw new Error("must not be called");
      },
    };
    await expect(queue.interruptWith(nonStreaming, { text: "hi" }, session)).rejects.toThrow(/does not support streaming/);
  });

  it("serializes superseded startup and cancels a late handle before starting its successor", async () => {
    const manager = new SessionManager();
    const session = manager.create("s7", "user-7");
    const starts: Array<{ signal: AbortSignal | undefined; resolve: (handle: SynthesisHandle) => void }> = [];
    const provider: SpeechProvider = {
      id: "deferred-provider",
      isPlaceholder: false,
      supportsStreaming: true,
      synthesize(_request, _session, options) {
        return new Promise((resolve) => starts.push({ signal: options?.signal, resolve }));
      },
    };
    const queue = new PlaybackQueue(100, 20);
    const first = queue.interruptWith(provider, { text: "first" }, session);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(starts).toHaveLength(1);
    const second = queue.interruptWith(provider, { text: "second" }, session);
    expect(starts[0]?.signal?.aborted).toBe(true);

    let firstCancelled = 0;
    let secondCancelled = 0;
    const lateFirstHandle = makeHandle([chunk(0, true)], () => firstCancelled++, "deferred-provider");
    const currentHandle = makeHandle([chunk(0, true)], () => secondCancelled++, "deferred-provider");
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    starts[0]!.resolve(lateFirstHandle);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(firstCancelled).toBe(1);
    expect(starts).toHaveLength(2);
    starts[1]!.resolve(currentHandle);
    await expect(second).resolves.toBe(currentHandle);
    await queue.stop();
    expect(secondCancelled).toBe(1);
  });

  it("times out provider startup, aborts it, and cancels a late result", async () => {
    const manager = new SessionManager();
    const session = manager.create("s8", "user-8");
    let resolveProvider: ((handle: SynthesisHandle) => void) | undefined;
    let signal: AbortSignal | undefined;
    const provider: SpeechProvider = {
      id: "slow-provider",
      isPlaceholder: false,
      supportsStreaming: true,
      synthesize(_request, _session, options) {
        signal = options?.signal;
        return new Promise((resolve) => {
          resolveProvider = resolve;
        });
      },
    };
    const queue = new PlaybackQueue(5, 20);
    await expect(queue.interruptWith(provider, { text: "slow" }, session)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(signal?.aborted).toBe(true);
    let cancelled = 0;
    resolveProvider?.(makeHandle([chunk(0, true)], () => cancelled++, "slow-provider"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toBe(1);
  });

  it("cancels the provider when async iterator creation throws", async () => {
    let cancelled = 0;
    const brokenFactory: SynthesisHandle = {
      providerId: "broken-factory-provider",
      placeholder: false,
      stream: {
        [Symbol.asyncIterator]() {
          throw new Error("iterator factory failed");
        },
      },
      async cancel() {
        cancelled += 1;
      },
    };
    await expect(collectOrdered(brokenFactory)).rejects.toThrow("iterator factory failed");
    expect(cancelled).toBe(1);
  });

  it("requires a final chunk, rejects data after final, and cancels streams on errors", async () => {
    const incomplete = makeHandle([chunk(0)]);
    await expect(collectOrdered(incomplete)).rejects.toThrow(/without a final chunk/);
    const extraChunk = makeHandle([chunk(0, true), chunk(1)]);
    await expect(collectOrdered(extraChunk)).rejects.toThrow(/after its final marker/);
    const gap = makeHandle([chunk(0), chunk(2, true)]);
    await expect(collectOrdered(gap)).rejects.toThrow(/Ordering violation/);

    let cancelled = 0;
    const broken: SynthesisHandle = {
      providerId: "broken-provider",
      placeholder: false,
      stream: {
        async *[Symbol.asyncIterator]() {
          yield chunk(0);
          throw new Error("provider stream failed");
        },
      },
      async cancel() {
        cancelled += 1;
      },
    };
    await expect(collectOrdered(broken)).rejects.toThrow("provider stream failed");
    expect(cancelled).toBe(1);
  });

  it("cancels a stream whose next chunk exceeds the idle timeout", async () => {
    let cancelled = 0;
    const stalled: SynthesisHandle = {
      providerId: "stalled-provider",
      placeholder: false,
      stream: {
        [Symbol.asyncIterator]() {
          return { next: () => new Promise<IteratorResult<AudioChunk>>(() => {}) };
        },
      },
      async cancel() {
        cancelled += 1;
      },
    };
    await expect(collectOrdered(stalled, { timeoutMs: 5, cleanupTimeoutMs: 10 })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(cancelled).toBe(1);
  });

  it("cancels the provider even if iterator.return never settles", async () => {
    let cancelled = 0;
    const stuck: SynthesisHandle = {
      providerId: "stuck-provider",
      placeholder: false,
      stream: {
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise<IteratorResult<AudioChunk>>(() => {}),
            return: () => new Promise<IteratorResult<AudioChunk>>(() => {}),
          };
        },
      },
      async cancel() {
        cancelled += 1;
      },
    };
    await expect(collectOrdered(stuck, { timeoutMs: 5, cleanupTimeoutMs: 10 })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(cancelled).toBe(1);
  });

  it("bounds a rejecting previous cancellation and fails closed without starting overlapping speech", async () => {
    const manager = new SessionManager();
    const session = manager.create("s9", "user-9");
    let starts = 0;
    const provider: SpeechProvider = {
      id: "reject-cancel-provider",
      isPlaceholder: false,
      supportsStreaming: true,
      async synthesize() {
        starts += 1;
        return {
          ...makeHandle([chunk(0, true)], () => {}, "reject-cancel-provider"),
          async cancel() {
            throw new Error("cancel failed");
          },
        };
      },
    };
    const queue = new PlaybackQueue(100, 10);
    await queue.interruptWith(provider, { text: "first" }, session);
    await expect(queue.interruptWith(provider, { text: "second" }, session)).rejects.toThrow(/did not confirm cancellation/);
    expect(starts).toBe(1);
  });

  it("bounds a hanging previous cancellation rather than waiting forever", async () => {
    const manager = new SessionManager();
    const session = manager.create("s10", "user-10");
    let starts = 0;
    const provider: SpeechProvider = {
      id: "hang-cancel-provider",
      isPlaceholder: false,
      supportsStreaming: true,
      async synthesize() {
        starts += 1;
        return {
          ...makeHandle([chunk(0, true)], () => {}, "hang-cancel-provider"),
          async cancel() {
            return new Promise<void>(() => {});
          },
        };
      },
    };
    const queue = new PlaybackQueue(100, 10);
    await queue.interruptWith(provider, { text: "first" }, session);
    await expect(queue.interruptWith(provider, { text: "second" }, session)).rejects.toThrow(/did not confirm cancellation/);
    expect(starts).toBe(1);
  });

  it("does not let a third concurrent request bypass an unresolved cancellation", async () => {
    const manager = new SessionManager();
    const session = manager.create("s11", "user-11");
    let starts = 0;
    const provider: SpeechProvider = {
      id: "triple-race-provider",
      isPlaceholder: false,
      supportsStreaming: true,
      async synthesize() {
        starts += 1;
        return {
          ...makeHandle([chunk(0, true)], () => {}, "triple-race-provider"),
          async cancel() {
            return new Promise<void>(() => {});
          },
        };
      },
    };
    const queue = new PlaybackQueue(100, 10);
    await queue.interruptWith(provider, { text: "first" }, session);
    const second = queue.interruptWith(provider, { text: "second" }, session);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const third = queue.interruptWith(provider, { text: "third" }, session);
    await expect(second).rejects.toThrow(/did not confirm cancellation/);
    await expect(third).rejects.toThrow(/blocked after unconfirmed/);
    expect(starts).toBe(1);
  });

  it("does not report stop complete while an aborted provider startup is unresolved", async () => {
    const manager = new SessionManager();
    const session = manager.create("s12", "user-12");
    const starts: Array<(handle: SynthesisHandle) => void> = [];
    let lateCancelled = 0;
    const provider: SpeechProvider = {
      id: "pending-stop-provider",
      isPlaceholder: false,
      supportsStreaming: true,
      synthesize() {
        return new Promise((resolve) => starts.push(resolve));
      },
    };
    const queue = new PlaybackQueue(100, 5);
    const first = queue.interruptWith(provider, { text: "first" }, session);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const stop = queue.stop();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(stop).rejects.toMatchObject({ name: "TimeoutError" });
    await expect(queue.interruptWith(provider, { text: "blocked" }, session)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(starts).toHaveLength(1);

    starts[0]!(makeHandle([chunk(0, true)], () => lateCancelled++, "pending-stop-provider"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lateCancelled).toBe(1);
    const current = queue.interruptWith(provider, { text: "after-cleanup" }, session);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(starts).toHaveLength(2);
    starts[1]!(makeHandle([chunk(0, true)], () => {}, "pending-stop-provider"));
    await expect(current).resolves.toMatchObject({ providerId: "pending-stop-provider" });
    await queue.stop();
  });

  it("rejects a handle whose provider ID or placeholder label conflicts with provider configuration", async () => {
    const manager = new SessionManager();
    const session = manager.create("s13", "user-13");
    let cancelled = 0;
    const provider: SpeechProvider = {
      id: "declared-demo-provider",
      isPlaceholder: true,
      supportsStreaming: true,
      async synthesize() {
        return makeHandle([chunk(0, true)], () => cancelled++, "different-provider", false);
      },
    };
    await expect(new PlaybackQueue().interruptWith(provider, { text: "mismatch" }, session)).rejects.toThrow(/mismatched handle provenance/);
    expect(cancelled).toBe(1);
  });
});
