/** Score a case-insensitive subsequence match. Higher is better; null = no match. */
export function fuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (q.length === 0) return 0;
  let score = 0;
  let ti = 0;
  let lastMatch = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    score += found === lastMatch + 1 ? 3 : 1; // consecutive bonus
    if (found === 0) score += 2; // prefix bonus
    lastMatch = found;
    ti = found + 1;
  }
  return score;
}

export function fuzzyFilter<T>(items: T[], query: string, key: (item: T) => string): T[] {
  if (query === "") return [...items];
  return items
    .map((item) => ({ item, score: fuzzyScore(key(item), query) }))
    .filter((e): e is { item: T; score: number } => e.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((e) => e.item);
}
