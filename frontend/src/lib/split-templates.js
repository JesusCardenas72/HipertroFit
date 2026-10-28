// The splits the plan generator builds from: each day an ordered list of movement-pattern slots.
//
// Slot order is the session order: the main compound first (the lift you most want to progress
// in load, done fresh), then the secondary compounds, then the single-joint work. A level keeps
// the first `slots` of each day (lib/plan-generator.js LEVELS). `prefer` nudges the default pick
// towards an exercise class ('compound' | 'machine') without restricting the list.
//
// `layouts` lay one week out per days-per-week: day keys and 'rest', Monday first. Only the
// calendar reads the rest days — the microcycle counts sessions, not days (lib/microcycle.js).
// Without A/B variants the B days are dropped and the A days repeat in their place.
// See docs/design/generador-de-rutinas.md.

const slot = (pattern, role, prefer) => ({ pattern, role, ...(prefer ? { prefer } : {}) })

export const SPLITS = {
  'full-body': {
    name: 'Full body', strategy: 'full-body', days: [2, 3], variants: false,
    plan: [
      { key: 'fb-a', name: 'Full body A', glyph: 'figureStrength', slots: [slot('squat', 'main'), slot('horizontal_push', 'main'), slot('horizontal_pull', 'secondary'), slot('lateral_raise', 'accessory'), slot('elbow_flexion', 'accessory'), slot('core_flexion', 'accessory')] },
      { key: 'fb-b', name: 'Full body B', glyph: 'barbell', slots: [slot('hinge', 'main'), slot('vertical_push', 'main'), slot('vertical_pull', 'secondary'), slot('lunge', 'secondary'), slot('elbow_extension', 'accessory'), slot('calf_raise', 'accessory')] },
      { key: 'fb-c', name: 'Full body C', glyph: 'dumbbell', slots: [slot('squat', 'secondary', 'machine'), slot('incline_push', 'secondary'), slot('horizontal_pull', 'secondary'), slot('knee_flexion', 'accessory'), slot('rear_delt', 'accessory'), slot('core_anti', 'accessory')] },
    ],
    layouts: { 3: ['fb-a', 'rest', 'fb-b', 'rest', 'fb-c', 'rest', 'rest'] },
  },
  'upper-lower': {
    name: 'Upper / Lower', strategy: 'upper-lower', days: [4], variants: true,
    plan: [
      { key: 'up-a', name: 'Upper A', glyph: 'upperDay', slots: [slot('horizontal_push', 'main'), slot('horizontal_pull', 'main'), slot('vertical_push', 'secondary'), slot('vertical_pull', 'secondary'), slot('elbow_flexion', 'accessory'), slot('elbow_extension', 'accessory'), slot('lateral_raise', 'accessory')] },
      { key: 'lo-a', name: 'Lower A', glyph: 'legDay', slots: [slot('squat', 'main'), slot('hinge', 'secondary'), slot('knee_extension', 'accessory'), slot('knee_flexion', 'accessory'), slot('calf_raise', 'accessory'), slot('core_flexion', 'accessory')] },
      { key: 'up-b', name: 'Upper B', glyph: 'upperDay', slots: [slot('vertical_pull', 'main'), slot('incline_push', 'main'), slot('horizontal_pull', 'secondary', 'machine'), slot('elbow_extension', 'accessory'), slot('elbow_flexion', 'accessory'), slot('chest_fly', 'accessory'), slot('rear_delt', 'accessory')] },
      { key: 'lo-b', name: 'Lower B', glyph: 'legDay', slots: [slot('hinge', 'main'), slot('squat', 'secondary', 'machine'), slot('lunge', 'secondary'), slot('knee_flexion', 'accessory'), slot('hip_extension', 'accessory'), slot('calf_raise', 'accessory')] },
    ],
    layouts: { 4: ['up-a', 'lo-a', 'rest', 'up-b', 'lo-b', 'rest', 'rest'] },
  },
  ppl: {
    name: 'Push / Pull / Legs', strategy: 'ppl', days: [5, 6], variants: true,
    plan: [
      { key: 'push-a', name: 'Push A', glyph: 'pushDay', slots: [slot('horizontal_push', 'main', 'compound'), slot('vertical_push', 'secondary'), slot('incline_push', 'secondary', 'machine'), slot('lateral_raise', 'accessory'), slot('elbow_extension', 'accessory'), slot('chest_fly', 'accessory')] },
      { key: 'pull-a', name: 'Pull A', glyph: 'pullDay', slots: [slot('vertical_pull', 'main'), slot('horizontal_pull', 'secondary'), slot('straight_arm_pull', 'accessory'), slot('rear_delt', 'accessory'), slot('elbow_flexion', 'accessory'), slot('shrug', 'accessory')] },
      { key: 'legs-a', name: 'Legs A', glyph: 'legDay', slots: [slot('squat', 'main'), slot('hinge', 'secondary'), slot('knee_extension', 'accessory'), slot('knee_flexion', 'accessory'), slot('calf_raise', 'accessory'), slot('core_flexion', 'accessory')] },
      { key: 'push-b', name: 'Push B', glyph: 'pushDay', slots: [slot('incline_push', 'main'), slot('horizontal_push', 'secondary', 'machine'), slot('vertical_push', 'secondary'), slot('lateral_raise', 'accessory'), slot('elbow_extension', 'accessory'), slot('chest_fly', 'accessory')] },
      { key: 'pull-b', name: 'Pull B', glyph: 'pullDay', slots: [slot('horizontal_pull', 'main'), slot('vertical_pull', 'secondary'), slot('rear_delt', 'accessory'), slot('elbow_flexion', 'accessory'), slot('lateral_raise', 'accessory'), slot('core_anti', 'accessory')] },
      { key: 'legs-b', name: 'Legs B', glyph: 'legDay', slots: [slot('hinge', 'main'), slot('squat', 'secondary', 'machine'), slot('lunge', 'secondary'), slot('knee_flexion', 'accessory'), slot('hip_extension', 'accessory'), slot('calf_raise', 'accessory')] },
    ],
    layouts: { 6: ['push-a', 'pull-a', 'legs-a', 'push-b', 'pull-b', 'legs-b', 'rest'] },
  },
}

export const SPLIT_KEYS = Object.keys(SPLITS)

/** The split that fits a number of training days a week. */
export const splitForDays = n => (n <= 3 ? 'full-body' : n === 4 ? 'upper-lower' : 'ppl')

/** Whether the split's B days are kept apart, or the A days repeat in their place. */
export const hasVariants = (split, variants) => split !== 'full-body' && !!variants

/** The days a split trains, A/B variants or not. */
export function daysOf(split, variants) {
  const plan = SPLITS[split].plan
  return hasVariants(split, variants) || split === 'full-body' ? plan : plan.filter(d => !d.key.endsWith('-b'))
}

/** One week of the split as day keys and 'rest', Monday first; B days become A days without variants. */
export function layoutOf(split, variants) {
  const sp = SPLITS[split]
  const week = Object.values(sp.layouts)[0]
  return hasVariants(split, variants) || split === 'full-body' ? [...week] : week.map(k => k.replace(/-b$/, '-a'))
}
