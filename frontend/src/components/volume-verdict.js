import { t } from '../lib/i18n.js'

// What each volumeVerdict (lib/volume.js) says under a group's name, and in which colour — shared
// by every volume panel so a group in the same spot reads the same everywhere.
export const VERDICT = {
  short: [n => t('{0} sets short of the minimum', n), 'var(--orange)'],
  shortWithPlan: [n => t('{0} sets short, even with the plan', n), 'var(--orange)'],
  planCovers: [() => t('The plan reaches the minimum'), 'var(--green)'],
  atMin: [() => t('At minimum'), 'var(--green)'],
  ok: [() => t('In range'), 'var(--green)'],
  planOver: [n => t('The plan goes {0} past the max', n), 'var(--red)'],
  over: [n => t('{0} sets past the max', n), 'var(--red)'],
}
