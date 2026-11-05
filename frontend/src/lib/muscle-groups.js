// Browsing the exercise library by muscle group (the "Ejercicios por músculo" view): which
// exercises train a given group, and how many per group for the group cards.

import { MUSCLES, musclesOf } from './muscles.js'

/** True when the exercise trains the muscle (primary or secondary), e.g. 'chest'. */
export const trainsMuscle = (ex, slug) => !!slug && (musclesOf(ex)[slug] || 0) > 0

/**
 * One { slug, count } per drawable muscle, in body order (MUSCLES), counting the exercises
 * in `list` that train it. Muscles with no exercises are kept, so the grid never reshuffles.
 */
export function muscleGroupCounts(list) {
  const counts = Object.fromEntries(MUSCLES.map(slug => [slug, 0]))
  for (const ex of list || []) {
    const weights = musclesOf(ex)
    for (const slug of MUSCLES) if ((weights[slug] || 0) > 0) counts[slug]++
  }
  return MUSCLES.map(slug => ({ slug, count: counts[slug] }))
}
