import type {
  AudioChunk,
  SpeechProvider,
  SpeechRequest,
  SpeechSession,
  SynthesisHandle,
} from "./types.js";
import { isAuthorizedSynthesisSession } from "./session.js";
import { chunkText } from "./streaming.js";

const makeAbortError = () => {
  const error = new Error("Speech synthesis startup was aborted");
  error.name = "AbortError";
  return error;
};

const makeTimeoutError = (message: string) => {
  const error = new Error(message);
  error.name = "TimeoutError";
  return error;
};

const cancelHandleSafely = async (handle: unknown, timeoutMs: number): Promise<boolean> => {
  const cancel = (handle as { cancel?: unknown } | null)?.cancel;
  if (typeof cancel !== "function") return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => cancel.call(handle)).then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const isSynthesisHandle = (value: unknown): value is SynthesisHandle => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SynthesisHandle>;
  return (
    typeof candidate.providerId === "string" &&
    candidate.providerId.trim().length > 0 &&
    typeof candidate.placeholder === "boolean" &&
    typeof candidate.cancel === "function" &&
    !!candidate.stream &&
    typeof candidate.stream[Symbol.asyncIterator] === "function"
  );
};

/**
 * Built-in OFFLINE SYNTHETIC provider for tests and demos. It emits
 * deterministic placeholder "audio" derived from the text — it does NOT
 * synthesize real speech and must never be described as a voice product.
 */
export class SyntheticTestProvider implements SpeechProvider {
  readonly id = "synthetic-test";
  readonly isPlaceholder = true;
  readonly supportsStreaming = true;

  async synthesize(
    request: SpeechRequest,
    session: SpeechSession,
    options: { signal?: AbortSignal } = {},
  ): Promise<SynthesisHandle> {
    if (!isAuthorizedSynthesisSession(session)) throw new Error("Session is not authorized for synthesis");
    if (options.signal?.aborted) throw makeAbortError();
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
    const abort = () => {
      cancelled = true;
      completed = true;
      queue.length = 0;
      wake();
    };
    const signal = options.signal;
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();

    // Emit chunks asynchronously; cancellation stops production immediately.
    void (async () => {
      try {
        for (let index = 0; index < parts.length; index++) {
          if (cancelled) break;
          queue.push({
            seq: index,
            data: new TextEncoder().encode(parts[index]!),
            final: index === parts.length - 1,
          });
          wake();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      } finally {
        completed = true;
        signal?.removeEventListener("abort", abort);
        wake();
      }
    })();

    const stream: AsyncIterable<AudioChunk> = {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<AudioChunk>> {
            while (queue.length === 0 && !cancelled && !completed) {
              await new Promise<void>((resolve) => {
                waiter.resolve = resolve;
              });
            }
            const value = queue.shift();
            if (value === undefined) return { done: true, value: undefined };
            return { done: false, value };
          },
        };
      },
    };
    return {
      providerId: this.id,
      placeholder: true,
      stream,
      async cancel() {
        abort();
        signal?.removeEventListener("abort", abort);
      },
    };
  }
}

type ActiveSynthesis = {
  controller: AbortController;
  handle?: SynthesisHandle;
  cancelHandle(handle: unknown): Promise<boolean>;
};

/**
 * Latest-request-wins playback queue. Lifecycle transitions are serialized.
 * Provider startup and all cleanup waits are bounded. A non-cooperative or
 * unconfirmed prior handle blocks further playback rather than overlapping.
 */
export class PlaybackQueue {
  private current: ActiveSynthesis | null = null;
  private generation = 0;
  private transitionTail: Promise<void> = Promise.resolve();
  private pendingStartups = new Set<Promise<void>>();
  private cleanupFailed = false;

  constructor(
    private readonly startupTimeoutMs = 15_000,
    private readonly cancellationTimeoutMs = 1_000,
  ) {
    if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0) {
      throw new Error("Provider startup timeout must be positive");
    }
    if (!Number.isFinite(cancellationTimeoutMs) || cancellationTimeoutMs <= 0) {
      throw new Error("Cancellation timeout must be positive");
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transitionTail.then(operation, operation);
    this.transitionTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertQueueSafe(): void {
    if (this.cleanupFailed) {
      throw new Error("Playback queue is blocked after unconfirmed provider cancellation; no new synthesis will start");
    }
  }

  /** Do not start new audio while an aborted provider is still able to return a late handle. */
  private async waitForPendingStartups(): Promise<void> {
    const pending = [...this.pendingStartups];
    if (pending.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      Promise.all(pending).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), this.cancellationTimeoutMs * 2 + 25);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!settled) {
      throw makeTimeoutError("Aborted provider startup is unresolved; new synthesis was not started");
    }
    this.assertQueueSafe();
  }

  private createActiveSynthesis(): ActiveSynthesis {
    const cancellations = new WeakMap<object, Promise<boolean>>();
    return {
      controller: new AbortController(),
      cancelHandle: (handle: unknown): Promise<boolean> => {
        if (!handle || typeof handle !== "object") {
          return cancelHandleSafely(handle, this.cancellationTimeoutMs).then((cancelled) => {
            if (!cancelled) this.cleanupFailed = true;
            return cancelled;
          });
        }
        const existing = cancellations.get(handle);
        if (existing) return existing;
        const attempt = cancelHandleSafely(handle, this.cancellationTimeoutMs).then((cancelled) => {
          if (!cancelled) this.cleanupFailed = true;
          return cancelled;
        });
        cancellations.set(handle, attempt);
        return attempt;
      },
    };
  }

  async interruptWith(
    provider: SpeechProvider,
    request: SpeechRequest,
    session: SpeechSession,
  ): Promise<SynthesisHandle> {
    if (!provider || typeof provider.id !== "string" || !provider.id.trim() || typeof provider.isPlaceholder !== "boolean") {
      throw new Error("Speech provider is unavailable or missing trustworthy placeholder metadata");
    }
    if (provider.supportsStreaming !== true) {
      throw new Error("Configured speech provider does not support streaming");
    }
    if (!isAuthorizedSynthesisSession(session)) {
      throw new Error("Session is not authorized for synthesis");
    }
    this.assertQueueSafe();

    const generation = ++this.generation;
    // Abort startup immediately, but leave the active handle tracked until its
    // cancellation is confirmed inside the serialized transition.
    this.current?.controller.abort();

    return this.serialize(async () => {
      this.assertQueueSafe();
      if (generation !== this.generation) throw makeAbortError();

      const previous = this.current;
      if (previous) {
        previous.controller.abort();
        if (previous.handle) {
          const cancelled = await previous.cancelHandle(previous.handle);
          if (!cancelled) {
            throw new Error("Previous speech handle did not confirm cancellation; new synthesis was not started");
          }
        }
        await this.waitForPendingStartups();
        if (this.current === previous) this.current = null;
      } else {
        await this.waitForPendingStartups();
      }
      this.assertQueueSafe();
      if (generation !== this.generation) throw makeAbortError();

      const active = this.createActiveSynthesis();
      this.current = active;
      let providerPromise: Promise<SynthesisHandle>;
      try {
        providerPromise = Promise.resolve(
          provider.synthesize(request, session, { signal: active.controller.signal }),
        ).then((handle) => {
          if (isSynthesisHandle(handle)) active.handle = handle;
          return handle;
        });
      } catch (error) {
        active.controller.abort();
        if (this.current === active) this.current = null;
        throw error;
      }

      const tracker = providerPromise.then(
        async (handle) => {
          if (
            active.controller.signal.aborted ||
            this.current !== active ||
            generation !== this.generation
          ) {
            await active.cancelHandle(handle);
          }
        },
        () => undefined,
      );
      this.pendingStartups.add(tracker);
      void tracker.finally(() => this.pendingStartups.delete(tracker));

      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      let rejectAbort: ((reason: Error) => void) | undefined;
      const onAbort = () => {
        if (!timedOut) rejectAbort?.(makeAbortError());
      };
      const abortPromise = new Promise<never>((_, reject) => {
        rejectAbort = (reason) => reject(reason);
      });
      active.controller.signal.addEventListener("abort", onAbort, { once: true });
      if (active.controller.signal.aborted) onAbort();
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          active.controller.abort();
          reject(makeTimeoutError("Speech provider startup timed out"));
        }, this.startupTimeoutMs);
      });

      try {
        const handle = await Promise.race([providerPromise, abortPromise, timeoutPromise]);
        if (
          !isSynthesisHandle(handle) ||
          handle.providerId !== provider.id ||
          handle.placeholder !== provider.isPlaceholder
        ) {
          const cancelled = await active.cancelHandle(handle);
          if (!cancelled) throw new Error("Invalid or mismatched provider handle; cancellation was not confirmed");
          throw new Error("Speech provider returned invalid or mismatched handle provenance");
        }
        if (this.current !== active || active.controller.signal.aborted || generation !== this.generation) {
          const cancelled = await active.cancelHandle(handle);
          if (!cancelled) throw new Error("Superseded speech handle did not confirm cancellation");
          throw makeAbortError();
        }
        return handle;
      } catch (error) {
        active.controller.abort();
        if (this.current === active) this.current = null;
        // This is idempotent through active.cancelHandle and also covers a
        // provider that resolves after abort/timeout.
        void providerPromise.then((handle) => active.cancelHandle(handle), () => false);
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        active.controller.signal.removeEventListener("abort", onAbort);
      }
    });
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.current?.controller.abort();
    return this.serialize(async () => {
      this.assertQueueSafe();
      const active = this.current;
      if (active) active.controller.abort();
      await this.waitForPendingStartups();
      this.assertQueueSafe();
      if (active?.handle) {
        const cancelled = await active.cancelHandle(active.handle);
        if (!cancelled) throw new Error("Speech handle did not confirm cancellation before timeout");
      }
      if (this.current === active) this.current = null;
    });
  }
}

export interface CollectOrderedOptions {
  /** Maximum idle time for each stream read; defaults to 30 seconds. */
  timeoutMs?: number;
  /** Maximum cleanup wait for provider cancel/iterator return; defaults to 1 second. */
  cleanupTimeoutMs?: number;
}

const readNextWithTimeout = (
  iterator: AsyncIterator<AudioChunk>,
  timeoutMs: number,
): Promise<IteratorResult<AudioChunk>> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(makeTimeoutError("Speech stream read timed out")), timeoutMs);
    try {
      Promise.resolve(iterator.next()).then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });

const closeIteratorSafely = async (iterator: AsyncIterator<AudioChunk>, timeoutMs: number): Promise<void> => {
  if (typeof iterator.return !== "function") return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => iterator.return?.()).then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Read a handle to completion, validating sequence numbers and one final marker. */
export async function collectOrdered(
  handle: SynthesisHandle,
  options: CollectOrderedOptions = {},
): Promise<AudioChunk[]> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 1_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Speech stream timeout must be positive");
  }
  if (!Number.isFinite(cleanupTimeoutMs) || cleanupTimeoutMs <= 0) {
    throw new Error("Cleanup timeout must be positive");
  }
  const output: AudioChunk[] = [];
  let iterator: AsyncIterator<AudioChunk> | undefined;
  let expected = 0;
  let sawFinal = false;

  try {
    iterator = handle.stream[Symbol.asyncIterator]();
    while (true) {
      const item = await readNextWithTimeout(iterator, timeoutMs);
      if (item.done) break;
      const chunk = item.value;
      if (sawFinal) throw new Error("Speech stream produced a chunk after its final marker");
      if (chunk.seq !== expected) {
        throw new Error(`Ordering violation: expected ${expected}, got ${chunk.seq}`);
      }
      expected += 1;
      sawFinal = chunk.final;
      output.push(chunk);
    }
    if (!sawFinal) throw new Error("Speech stream ended without a final chunk");
    return output;
  } catch (error) {
    // Initiate provider cancellation first and in parallel with iterator close;
    // neither non-cooperative hook can block the other indefinitely.
    await Promise.all([
      cancelHandleSafely(handle, cleanupTimeoutMs),
      iterator ? closeIteratorSafely(iterator, cleanupTimeoutMs) : Promise.resolve(),
    ]);
    throw error;
  }
}
