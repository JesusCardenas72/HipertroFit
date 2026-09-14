// The prompt that goes with an ai-digest.js digest, and the shape of the answer asked for.
//
// Phase one pastes this into whatever chat assistant the user already has, so it must stand on
// its own: what the app is, what the fields mean, and the rules the app itself trains by
// (effective sets, 10–20 per group per microcycle, double progression, deload after three
// loading microcycles). The same text is what a configured provider will receive later, with
// RESPONSE_SCHEMA as its structured-output contract.

import { LANGS } from './i18n-core.js'
import { VOLUME_TARGET, EFFECTIVE_RIR, VOLUME_GROUPS } from './volume.js'
import { DELOAD_AFTER, DELOAD_MAX } from './mesocycle.js'

/** The structured answer requested from the model (JSON Schema, OpenAI `response_format` style). */
export const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'alerts', 'suggestions'],
  properties: {
    summary: { type: 'string' },
    alerts: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['type', 'detail'],
        properties: {
          type: { type: 'string', enum: ['stall', 'fatigue', 'volume', 'deload', 'adherence', 'bodyweight', 'other'] },
          target: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
    suggestions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['action', 'reason'],
        properties: {
          action: { type: 'string', enum: ['increase_weight', 'add_set', 'reduce_volume', 'add_volume', 'deload', 'swap_exercise', 'keep', 'other'] },
          target: { type: 'string' },
          // The muscle group an add_volume / reduce_volume suggestion is about — the app can only
          // turn those into a routine change when it names one of its own group keys.
          group: { type: 'string', enum: VOLUME_GROUPS.map(g => g.key) },
          reason: { type: 'string' },
        },
      },
    },
  },
}

/** What the user wants out of the analysis. Keys are stable; the UI labels them. */
export const FOCUS = ['overview', 'progression', 'programming', 'volume']

const FOCUS_TEXT = {
  overview: 'Give an overall review of the current training.',
  progression: 'Focus on progression: which exercises advance, which are stalled or fatigued, and what to do with each.',
  programming: 'Focus on programming: the microcycle sequence, session distribution, adherence and whether a deload is due.',
  volume: 'Focus on volume: effective sets per muscle group against the target band, and how to rebalance the routines.',
}

/**
 * The full prompt: instructions, then the digest as JSON.
 *
 * `lang` is the app language tag (answers come back in it); `focus` one of FOCUS;
 * `json` asks for RESPONSE_SCHEMA instead of prose — off for a hand-pasted chat.
 */
export function buildPrompt(digest, { lang = 'en', focus = 'overview', json = false } = {}) {
  const language = LANGS[lang] || LANGS.en
  const lines = [
    'You are a strength and hypertrophy coach reviewing a training log exported from HipertroFit, a gym tracker.',
    FOCUS_TEXT[focus] || FOCUS_TEXT.overview,
    '',
    'How the app trains (use these rules, do not replace them with others):',
    `- Volume is counted in effective sets: completed work sets at RIR <= ${EFFECTIVE_RIR} (unrated sets count). Secondary muscles earn partial credit.`,
    `- Target per muscle group per microcycle: ${VOLUME_TARGET.min}–${VOLUME_TARGET.max} effective sets.`,
    '- A microcycle is a count of sessions, not a week: full-body 3, upper-lower 4, push/pull/legs 6.',
    `- A deload microcycle (25–50% less work) is suggested after ${DELOAD_AFTER} loading microcycles and required after ${DELOAD_MAX}.`,
    '- Double progression: add reps within the range at the same weight; once every set reaches the top, add weight or a set. Reps falling from set to set mean fatigue: no overload next session.',
    '',
    'Data notes:',
    `- Weights are in ${digest.unit}. Sets are written weight x reps, "@n" is RIR when logged.`,
    '- "findings" were computed by the app itself; treat them as facts and explain them, do not contradict them.',
    '- volume.current is the microcycle in progress (may be incomplete); volume.planned is what the programming prescribes.',
    '- progression.state is one of first, climbing, ready, fatigue, deload, bodyweight.',
    '',
    'Rules for your answer:',
    '- Use only the numbers in the data. Never invent figures; if something cannot be judged from the data, say so.',
    '- Be concrete: name the exercise or muscle group and the change (kg, sets, reps).',
    `- For add_volume and reduce_volume suggestions, set "group" to one of: ${VOLUME_GROUPS.map(g => g.key).join(', ')}.`,
    '- This is training guidance, not medical advice. If the data suggests pain or injury, recommend a professional.',
    `- Answer in ${language}.`,
    json
      ? '- Reply with JSON only, matching: {"summary": string, "alerts": [{"type","target","detail"}], "suggestions": [{"action","target","group","reason"}]}. action is one of increase_weight, add_set, reduce_volume, add_volume, deload, swap_exercise, keep, other.'
      : '- Structure: a short summary, then alerts, then at most 5 prioritised suggestions.',
    '',
    'Data:',
    JSON.stringify(digest),
  ]
  return lines.join('\n')
}

/** Rough token count (≈4 characters per token) — enough to warn before a free-tier limit. */
export const approxTokens = text => Math.ceil(String(text || '').length / 4)
