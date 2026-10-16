import type { PronunciationRule } from "./types.js";

/**
 * Pronunciation lexicon: ordered rule application, longest-match-first within
 * a locale. Rules are data, never code — safe to load from packs.
 */
export class PronunciationLexicon {
  private rules: PronunciationRule[] = [];

  addRules(rules: PronunciationRule[]): void {
    this.rules.push(...rules);
    // Longest grapheme first for deterministic greedy matching.
    this.rules.sort((a, b) => b.grapheme.length - a.grapheme.length);
  }

  /** Respell text using the lexicon. Later rules never override earlier, longer matches. */
  respell(text: string, locale?: string): string {
    const applicable = this.rules.filter((r) => !r.locale || !locale || r.locale === locale);
    if (applicable.length === 0) return text;
    let out = "";
    let i = 0;
    while (i < text.length) {
      const hit = applicable.find((r) => text.startsWith(r.grapheme, i));
      if (hit) {
        out += hit.phoneme;
        i += hit.grapheme.length;
      } else {
        out += text[i];
        i += 1;
      }
    }
    return out;
  }

  ruleCount(): number {
    return this.rules.length;
  }
}
