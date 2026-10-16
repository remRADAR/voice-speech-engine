import { describe, it, expect } from "vitest";
import { ChunkOrderingBuffer, chunkText } from "../src/streaming.js";
import { PronunciationLexicon } from "../src/pronunciation.js";

describe("ChunkOrderingBuffer", () => {
  it("passes in-order chunks and rejects gaps/repeats/out-of-order", () => {
    const seen: number[] = [];
    const buf = new ChunkOrderingBuffer((c) => seen.push(c.seq));
    buf.push({ seq: 0, data: new Uint8Array(1), final: false });
    buf.push({ seq: 1, data: new Uint8Array(1), final: true });
    expect(seen).toEqual([0, 1]);
    expect(() => buf.push({ seq: 1, data: new Uint8Array(1), final: true })).toThrow(/violation/i);
    expect(() => buf.push({ seq: 5, data: new Uint8Array(1), final: true })).toThrow(/violation/i);
  });
});

describe("chunkText", () => {
  it("produces non-empty chunks covering all words", () => {
    const chunks = chunkText("the quick brown fox jumps over the lazy dog");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join(" ").split(/\s+/)).toContain("fox");
  });
  it("handles empty input", () => {
    expect(chunkText("   ")).toEqual([]);
  });
});

describe("PronunciationLexicon", () => {
  it("applies longest-match-first respelling", () => {
    const lex = new PronunciationLexicon();
    lex.addRules([
      { grapheme: "ch", phoneme: "tʃ" },
      { grapheme: "sh", phoneme: "ʃ" },
      { grapheme: "ọ", phoneme: "ɔ" },
    ]);
    expect(lex.respell("church")).toBe("tʃurtʃ");
    expect(lex.respell("shó")).toBe("ʃó");
    expect(lex.respell("ọba")).toBe("ɔba");
  });

  it("respects locale scoping", () => {
    const lex = new PronunciationLexicon();
    lex.addRules([
      { grapheme: "gb", phoneme: "ɡ͡b", locale: "yor" },
      { grapheme: "gb", phoneme: "gb", locale: "en" },
    ]);
    expect(lex.respell("gbà", "yor")).toBe("ɡ͡bà");
    expect(lex.respell("gbà", "en")).toBe("gbà");
    // No locale: all rules apply, longest/first-sorted.
    expect(["ɡ͡bà", "gbà"]).toContain(lex.respell("gbà"));
  });
});
