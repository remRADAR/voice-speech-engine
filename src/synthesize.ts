import type { AudioChunk, SpeechProvider, SpeechRequest, SpeechSession, SynthesisHandle } from "./types.js";
import { chunkText } from "./streaming.js";

/**
 * Built-in OFFLINE SYNTHETIC provider for tests and demos. It emits
 * deterministic placeholder "audio" derived from the text — it does NOT
 * synthesize real speech and must never be described as a voice product.
 */
export class SyntheticTestProvider implements SpeechProvider {
  readonly id = "synthetic-test";
  readonly supportsStreaming = true;

  async synthesize(request: SpeechRequest, session: SpeechSession): Promise<SynthesisHandle> {
    if (!session.capabilities.synthesize) throw new Error("Session is not authorized for synthesis");
    const parts = chunkText(request.text || "");
    if (parts.length === 0) throw new Error("Nothing to synthesize");
    let cancelled = false;
    let completed = false;
    const queue: AudioChunk[] = [];
    const waiter: { resolve?: () => void } = {};
    const wake = () => {
      waiter.resolve?.();
      waiter.resolve = undefined;
    };

    // Emit chunks asynchronously; cancellation stops production immediately.
    void (async () => {
      try {
        for (let i = 0; i < parts.length; i++) {
          if (cancelled) break;
          const chunk: AudioChunk = {
            seq: i,
            data: new TextEncoder().encode(parts[i]!),
            final: i === parts.length - 1,
          };
          queue.push(chunk);
          wake();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } finally {
        completed = true;
        wake();
      }
    })();

    const stream: AsyncIterable<AudioChunk> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<AudioChunk>> {
            while (queue.length === 0 && !cancelled && !completed) {
              await new Promise<void>((resolve) => { waiter.resolve = resolve; });
            }
            const value = queue.shift();
            if (value === undefined) return { done: true, value: undefined };
            return { done: false, value };
          },
        };
      },
    };
    return {
      stream,
      async cancel() {
        cancelled = true;
        completed = true;
        queue.length = 0;
        wake();
      },
    };
  }
}

/**
 * Interruption policy: when a new request arrives mid-playback, cancel the old
 * handle first so audio never overlaps.
 */
export class PlaybackQueue {
  private current: SynthesisHandle | null = null;

  async interruptWith(provider: SpeechProvider, request: SpeechRequest, session: SpeechSession): Promise<SynthesisHandle> {
    if (this.current) await this.current.cancel();
    this.current = await provider.synthesize(request, session);
    return this.current;
  }

  async stop(): Promise<void> {
    await this.current?.cancel();
    this.current = null;
  }
}

/** Read a handle to completion, collecting chunks; validates strict ordering. */
export async function collectOrdered(handle: SynthesisHandle): Promise<AudioChunk[]> {
  const out: AudioChunk[] = [];
  let expected = 0;
  for await (const chunk of handle.stream) {
    if (chunk.seq !== expected) throw new Error(`Ordering violation: expected ${expected}, got ${chunk.seq}`);
    expected += 1;
    out.push(chunk);
  }
  return out;
}
