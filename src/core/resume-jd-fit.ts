/**
 * Heuristic résumé ↔ job-description keyword overlap (no proprietary keyword blobs).
 * Use for lightweight "fit" hints before apply; AI screening remains authoritative when enabled.
 */

const STOP = new Set([
  'the',
  'and',
  'for',
  'with',
  'you',
  'our',
  'are',
  'this',
  'that',
  'your',
  'from',
  'will',
  'have',
  'been',
  'were',
  'their',
  'they',
  'who',
  'but',
  'not',
  'all',
  'any',
  'can',
  'may',
  'into',
  'about',
  'also',
  'than',
  'then',
  'such',
  'via',
  'per',
  'using',
  'including',
  'etc',
  'we',
  'us',
  'as',
  'an',
  'a',
  'of',
  'in',
  'on',
  'at',
  'to',
  'is',
  'it',
  'or',
  'be',
  'by',
  'if',
  'so',
  'no',
  'do'
])

function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/gi, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length >= 2 && !STOP.has(t))
}

/**
 * Adjacent token pairs joined with '_', enabling compound-term matching.
 * "machine learning" → "machine_learning"; "react native" → "react_native".
 * Applied to both resume and JD before set operations so partial unigram
 * matches on generic words don't drown out phrase-level signal.
 */
function extractBigrams(tokens: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(`${tokens[i]}_${tokens[i + 1]}`)
  }
  return out
}

/** Frequency map over a flat token list. */
function buildTermFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
  return tf
}

/**
 * Weighted Asymmetric Coverage (WAC) of `jdTf` terms by `resumeTokens`.
 *
 * Each JD term is weighted by:
 *   - `tf`  — frequency in the JD; repetition signals employer emphasis.
 *   - `specificity` — `min(2, token.length / 5)`: longer terms are more
 *     discriminative than short generic words (poor-man's IDF without a corpus).
 *
 * Crucially **asymmetric**: resume tokens that don't appear in the JD add
 * nothing to the denominator, so a comprehensive resume with diverse skills
 * is never penalised for breadth — only JD coverage matters.
 */
function computeWeightedCoverage(
  resumeTokens: Set<string>,
  jdTf: Map<string, number>
): number {
  if (jdTf.size === 0) return 0
  let weightedMatch = 0
  let totalWeight = 0
  for (const [term, freq] of jdTf) {
    const specificity = Math.min(2, term.length / 5)
    const weight = freq * specificity
    totalWeight += weight
    if (resumeTokens.has(term)) weightedMatch += weight
  }
  return totalWeight > 0 ? weightedMatch / totalWeight : 0
}

/**
 * Weighted Asymmetric Coverage score for résumé ↔ JD fit, scaled 0–100.
 *
 * Replaces the previous binary Jaccard implementation, which had a structural
 * flaw: its symmetric denominator (`|resume ∪ JD|`) grew with resume breadth,
 * systematically ranking senior candidates lower than juniors even when they
 * covered every JD requirement.
 *
 * Algorithm:
 *   1. Tokenise both texts and extract unigrams + bigrams.
 *   2. Compute **Weighted Asymmetric Coverage** (WAC) — JD-centric, TF-weighted,
 *      specificity-scaled — measuring "what fraction of what the JD emphasises
 *      does the résumé cover?".
 *   3. Blend with residual Jaccard (30%) as a symmetry correction that guards
 *      against trivial résumé-stuffing (repeating all JD words verbatim).
 *   4. Return `coverageScore` alongside the blended `score0to100` so callers
 *      can surface the directional signal when needed.
 *
 * Score blend: `final = 0.70 × WAC + 0.30 × Jaccard`
 */
export function scoreResumeAgainstJobDescription(
  resumeText: string,
  jobDescription: string
): {
  score0to100: number
  coverageScore: number
  matchedTerms: string[]
  resumeTokenCount: number
  jobTokenCount: number
} {
  const rTokens = tokenize(resumeText)
  const jTokens = tokenize(jobDescription)

  const r = new Set(rTokens)
  const j = new Set(jTokens)

  if (r.size === 0 || j.size === 0) {
    return { score0to100: 0, coverageScore: 0, matchedTerms: [], resumeTokenCount: r.size, jobTokenCount: j.size }
  }

  // Augment token sets with bigrams for phrase-level matching
  const rAll = new Set([...rTokens, ...extractBigrams(rTokens)])
  const jAllTokens = [...jTokens, ...extractBigrams(jTokens)]
  const jAll = new Set(jAllTokens)

  // Intersection and union over augmented sets
  const inter: string[] = []
  for (const t of rAll) {
    if (jAll.has(t)) inter.push(t)
  }
  const union = rAll.size + jAll.size - inter.length
  const jac = union > 0 ? inter.length / union : 0

  // Weighted asymmetric coverage — JD-centric, tf × specificity weighting.
  // Uses UNIGRAMS only: bigrams inflate the denominator without reliable
  // phrase-level resume matches, diluting coverage for unigram overlap.
  // Bigrams are already captured in the Jaccard component above.
  const jdTf = buildTermFrequencies(jTokens)
  const coverage = computeWeightedCoverage(rAll, jdTf)

  // Blend: coverage-biased (job matching is directional) with Jaccard floor
  const blended = coverage * 0.7 + jac * 0.3

  // matchedTerms: unigrams only, for human-readable display
  const unigramMatches = inter.filter((t) => !t.includes('_'))

  return {
    score0to100: Math.round(blended * 100),
    coverageScore: Math.round(coverage * 100),
    matchedTerms: unigramMatches.slice(0, 80).sort(),
    resumeTokenCount: r.size,
    jobTokenCount: j.size,
  }
}
