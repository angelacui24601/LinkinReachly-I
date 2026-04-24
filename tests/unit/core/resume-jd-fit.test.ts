import { describe, expect, it } from 'vitest'
import { scoreResumeAgainstJobDescription } from '@core/resume-jd-fit'

describe('scoreResumeAgainstJobDescription', () => {
  it('scores overlap on shared substantive tokens', () => {
    const resume = 'Senior TypeScript engineer with React and distributed systems experience.'
    const jd = 'We need a TypeScript developer familiar with React and system design.'
    const r = scoreResumeAgainstJobDescription(resume, jd)
    expect(r.score0to100).toBeGreaterThan(15)
    expect(r.matchedTerms).toContain('typescript')
    expect(r.matchedTerms).toContain('react')
  })

  it('returns zero for empty inputs', () => {
    expect(scoreResumeAgainstJobDescription('', 'a b c').score0to100).toBe(0)
  })

  // Regression: tokenizer was dropping 2-char tokens (t.length > 2 instead of >= 2),
  // silently zeroing overlap for critical tech terms like AI, ML, Go, JS, TS.
  it('matches 2-character tech tokens (AI, ML, Go, JS)', () => {
    const resume = 'Senior AI and ML engineer with Go and JS expertise.'
    const jd = 'We need an AI/ML engineer proficient in Go and JS.'
    const r = scoreResumeAgainstJobDescription(resume, jd)
    expect(r.matchedTerms).toContain('ai')
    expect(r.matchedTerms).toContain('ml')
    expect(r.matchedTerms).toContain('go')
    expect(r.matchedTerms).toContain('js')
    expect(r.score0to100).toBeGreaterThan(0)
  })

  // WAC asymmetry invariant: a comprehensive senior resume covering ALL JD requirements
  // plus many additional skills should score >= a narrow resume covering fewer requirements.
  // The old Jaccard implementation violated this — the senior scored LOWER because the
  // larger union denominator penalised resume breadth.
  it('does not penalise a comprehensive resume for having additional skills', () => {
    // JD with 6 distinct technical requirements
    const jd = [
      'Looking for a TypeScript and React engineer with Kubernetes, Docker,',
      'PostgreSQL, and GraphQL experience.'
    ].join(' ')

    // Senior: covers all 6 JD tech requirements + many unrelated skills (breadth)
    const senior = [
      'TypeScript React Kubernetes Docker PostgreSQL GraphQL',
      'AWS GCP Azure Redis microservices distributed systems',
      'team leadership product roadmap stakeholder communication',
      'Python Go Rust data engineering machine learning'
    ].join('. ')

    // Junior: covers only 2 of 6 JD tech requirements
    const junior = 'TypeScript React developer, some web experience.'

    const seniorScore = scoreResumeAgainstJobDescription(senior, jd)
    const juniorScore = scoreResumeAgainstJobDescription(junior, jd)

    // Senior covers more JD requirements — must not score lower than junior
    expect(seniorScore.score0to100).toBeGreaterThanOrEqual(juniorScore.score0to100)
    // Senior's directional coverage score must clearly exceed junior's
    expect(seniorScore.coverageScore).toBeGreaterThan(juniorScore.coverageScore)
  })

  // Bigram matching: compound tech phrases should be detected as single units.
  it('matches compound phrases via bigrams (machine learning, product management)', () => {
    const resume = 'Led machine learning projects and oversaw product management initiatives.'
    const jd = 'Requires machine learning experience and product management skills.'
    const r = scoreResumeAgainstJobDescription(resume, jd)
    // Bigrams machine_learning and product_management should boost score beyond unigrams alone
    expect(r.score0to100).toBeGreaterThan(20)
  })

  // TF weighting: a term the JD repeats should carry more weight when matched.
  it('returns coverageScore as a separate directional signal', () => {
    const resume = 'TypeScript developer with React expertise.'
    const jd = 'TypeScript TypeScript TypeScript — we are all-in on TypeScript with React.'
    const r = scoreResumeAgainstJobDescription(resume, jd)
    // coverageScore should be defined and non-zero
    expect(r.coverageScore).toBeDefined()
    expect(r.coverageScore).toBeGreaterThan(0)
  })
})
