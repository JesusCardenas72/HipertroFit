// Runtime-agnostic core of the i18n module: state, constants and readers (t, dateLocale,
// instrFor, exerciseNameFor, getLang). Plain Node-loadable — the browser-only pieces
// (import.meta.glob lazy
// loads, the React subscription hook) live in i18n.js and re-export from here.

import { displayName, searchText, cleanOverride, DEFAULT_NAME_STYLE } from './exercise-name.js'

export const LANGS = {
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano',
  pt: 'Português (Portugal)', 'pt-BR': 'Português (Brasil)', pl: 'Polski',
  tr: 'Türkçe', ru: 'Русский', zh: '中文',
  ko: '한국어', hi: 'हिन्दी', th: 'ไทย', hu: 'Magyar'
}
export const INSTR_LANGS = ['en', 'es', 'fr', 'it', 'tr', 'ru', 'zh', 'hi', 'pl', 'ko', 'pt-BR', 'hu']
export const EXERCISE_NAME_LANGS = ['es', 'pt-BR', 'hu']
export const DATE_LOCALES = {
  en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT', 'pt-BR': 'pt-BR',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN', th: 'th-TH', hu: 'hu-HU'
}

let lang = 'en'                 // set only by _setLangState, called from i18n.js setLang
let dict = {}                   // current locale pack (empty = English fallback)
let instr = null                // { exId: [steps] } for the current language, null = English
let exerciseNames = null        // { exId: translated name }, null = original catalogue name
// Both come from persisted state (S.exNameStyle / S.exNames) rather than from a locale pack, so
// they survive a language switch and are set separately — see _setExerciseNameOptions.
let nameStyle = DEFAULT_NAME_STYLE  // 'bilingual' = "translated (English)", 'local' = translated only
let nameOverrides = {}          // { exId: name you typed by hand }, wins over both of the above
let version = 0                 // bumped on every setLang; drives the React subscription selector

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'en-GB'
export const getVersion = () => version

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  // A plural key (an object of forms, read by tn()) reached through plain t(): pick a form.
  if (v && typeof v === 'object') {
    const forms = v
    v = (typeof args[0] === 'number' && forms[pluralCategory(args[0])]) || forms.other || forms.many || forms.one || s
  }
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}

// CLDR plural category for `n` in the current language, from the platform (Intl.PluralRules).
const pluralCategory = n => {
  try { return new Intl.PluralRules(dateLocale()).select(n) }
  catch { return n === 1 ? 'one' : 'other' }
}

/**
 * A translated count (ported from openGym 1.4.5 with the AI Coach). `one` and `other` are the
 * English source strings; `n` picks the form. A pack entry may be a plain string or an object of
 * CLDR forms ({ one, few, many, other }), falling back through `other` to the English pair.
 */
export function tn(one, other, n, ...rest) {
  const forms = dict[other]
  if (forms && typeof forms === 'object') {
    const form = forms[pluralCategory(n)] || forms.other || forms.many || forms.one
    if (form) {
      let v = form
      const args = [n, ...rest]
      for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
      return v
    }
  }
  return t(n === 1 ? one : other, n, ...rest)
}

// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []

// What an exercise is called on screen. A name you typed by hand wins; otherwise a complete
// translated name pack gives either "translated (English)" or the translation alone, depending
// on the style you picked. User-created exercises have no entry in the pack, so with no override
// they keep their exact chosen name. The policy itself is `displayName` in exercise-name.js.
const translatedNameFor = ex => (exerciseNames && ex && exerciseNames[ex.id]) || ''

export const exerciseNameFor = ex => displayName({
  base: ex?.n || '',
  translated: translatedNameFor(ex),
  override: ex && nameOverrides[ex.id],
  style: nameStyle,
  lang,
})

/** The same name with any manual rename ignored — what clearing the rename field goes back to. */
export const catalogueNameFor = ex => displayName({
  base: ex?.n || '',
  translated: translatedNameFor(ex),
  style: nameStyle,
  lang,
})

// Search the name on screen, the localized title and the canonical English one, so neither a
// rename nor the 'local' style can hide an exercise from the name you have been typing for it.
export const exerciseNameSearchText = ex => searchText({
  base: ex?.n || '',
  translated: translatedNameFor(ex),
  override: ex && nameOverrides[ex.id],
})

/** The manual name for an exercise, or '' — what the rename sheet prefills and clears. */
export const exerciseNameOverrideFor = ex => cleanOverride(ex && nameOverrides[ex.id])

/**
 * Apply the persisted naming preferences (S.exNameStyle, S.exNames). Kept apart from
 * _setLangState because these are yours, not the locale pack's: switching language must not
 * reset them. Bumps `version` so the React subscription re-renders, the same way a language
 * switch does. Returns the new version.
 */
export function _setExerciseNameOptions(style, overrides) {
  nameStyle = style === 'local' ? 'local' : DEFAULT_NAME_STYLE
  nameOverrides = overrides || {}
  version++
  return version
}

// Called by i18n.js's setLang once the locale pack has been loaded — kept here rather than
// exported as setLang because loading packs requires import.meta.glob, which is Vite-only.
// `dict`, `instr` and `exerciseNames` may be null to reset to their English fallbacks.
export function _setLangState(newLang, newDict, newInstr, newExerciseNames) {
  lang = LANGS[newLang] ? newLang : 'en'
  dict = lang === 'en' ? {} : (newDict || {})
  instr = lang === 'en' || !INSTR_LANGS.includes(lang) ? null : (newInstr || null)
  exerciseNames = lang === 'en' || !EXERCISE_NAME_LANGS.includes(lang) ? null : (newExerciseNames || null)
  version++
  return version
}
