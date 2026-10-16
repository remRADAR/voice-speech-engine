import type { AudioChunk } from "./types.js";

/**
 * Ordered chunk assembler. Guards against out-of-order, repeated, or gapped
 * sequences — a corrupted stream raises rather than producing glitched audio.
 */
export class ChunkOrderingBuffer {
  private expected = 0;

  constructor(private onChunk: (chunk: AudioChunk) => void) {}

  push(chunk: AudioChunk): void {
    if (chunk.seq !== this.expected) {
      throw new Error(`Chunk sequence violation: expected ${this.expected}, got ${chunk.seq}`);
    }
    this.expected += 1;
    this.onChunk(chunk);
  }

  get nextExpected(): number {
    return this.expected;
  }
}

/** Deterministic text chunker used by the built-in synthetic provider. */
export function chunkText(text: string, size = 40): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const w of words) {
    current.push(w);
    count += w.length;
    if (count >= size) {
      chunks.push(current.join(" "));
      current = [];
      count = 0;
    }
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}
