import { useState } from 'react'
import Icon from './Icon.jsx'
import { Button, Segmented } from './ui.jsx'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { EXIDX } from '../lib/exercises.js'
import { VOLUME_GROUPS } from '../lib/volume.js'
import { glyphOfMuscle } from '../lib/glyphs.js'
import { feedbackGroups, normalizeFeedback, feedbackPlan, rampOn, FEEDBACK_FIELDS } from '../lib/muscle-feedback.js'

// The two ends of the per-group feedback (lib/muscle-feedback.js): the questions asked when a
// session ends, and the set changes they add up to when the microcycle closes.

/** Whether the questions are asked at all (Settings ▸ Training). On unless switched off. */
export const feedbackOn = S => !!S && S.muscleFeedback !== false
/** Whether closing a microcycle proposes set changes at all: from the answers, or the volume ramp. */
export const adjustmentsOn = S => feedbackOn(S) || rampOn(S)

const FIELD = {
  pump: { q: 'Pump', a: ['Low', 'Good', 'Great'] },
  work: { q: 'Workload', a: ['Easy', 'About right', 'Too much'] },
  sore: { q: 'Soreness coming in', a: ['Not sore', 'Healed in time', 'Still sore'] },
}
// The "why" behind a proposed step, one short phrase per answer that pushed it.
const REASON = {
  pump: ['low pump', null, 'great pump'],
  work: ['easy workload', null, 'too much work'],
  sore: ['no soreness', null, 'still sore'],
}

const groupGlyph = g => {
  for (const m of (g && g.muscles) || []) { const k = glyphOfMuscle(m); if (k) return k }
  return null
}
const groupOf = key => VOLUME_GROUPS.find(g => g.key === key)

/* ---------- asked when a session ends ---------- */

// Every answer starts on the middle option — the neutral one — so a group that felt as expected
// costs no taps; only what was different needs touching.
function MuscleFeedback({ w, close, then }) {
  const update = useStore(s => s.update)
  const groups = feedbackGroups(w)
  const [answers, setAnswers] = useState(() => Object.fromEntries(groups.map(g => [g.key, { pump: 1, work: 1, sore: 1 }])))
  const set = (key, f, v) => setAnswers(a => ({ ...a, [key]: { ...a[key], [f]: v } }))
  const save = () => {
    const fb = normalizeFeedback(answers)
    update(s => { const x = (s.workouts || []).find(y => y.id === w.id); if (x) x.feedback = fb })
    close(); then()
  }
  return <div style={{ padding: '4px 0' }}>
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 40, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="target" /></div>
      <h3 style={{ margin: '8px 0' }}>{t('How did each muscle respond?')}</h3>
      <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
        {t('When the microcycle closes, your answers adjust its sets: more where you recover with room to spare, fewer where you arrive still sore.')}
      </div>
    </div>
    {groups.map(g => {
      const glyph = groupGlyph(groupOf(g.key))
      return <div key={g.key} className="sect-b" style={{ marginBottom: 12, padding: '10px 12px' }} data-testid={'fb-' + g.key}>
        <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'nowrap' }}>
          {glyph && <Icon name={glyph} className="vol-glyph" />}
          <b style={{ flex: 1 }}>{t(g.name)}</b>
          <span className="small dim">{t('{0} sets', fmtNum(g.sets))}</span>
        </div>
        {FEEDBACK_FIELDS.map(f => <div key={f} style={{ marginBottom: 6 }}>
          <div className="small dim" style={{ marginBottom: 4 }}>{t(FIELD[f].q)}</div>
          <Segmented options={FIELD[f].a.map((label, v) => ({ value: v, label: t(label) }))}
            value={answers[g.key][f]} onChange={v => set(g.key, f, v)} />
        </div>)}
      </div>
    })}
    <Button variant="primary" icon="check" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => { close(); then() }}>{t('Skip')}</Button>
  </div>
}

/**
 * Open the questions for a workout just filed, then `then`. Straight to `then` when they are
 * switched off or the session trained no group enough to ask about.
 */
export function maybeMuscleFeedback(S, w, openSheet, then) {
  if (!feedbackOn(S) || !w || !feedbackGroups(w).length) return then()
  openSheet(close => <MuscleFeedback w={w} close={close} then={then} />, { locked: true })
}

/* ---------- read back when the microcycle closes ---------- */

const signed = n => (n > 0 ? '+' : '') + fmtNum(n)
// Why a group's step could not be turned into set changes (nudgeBlocker).
const CAPPED = {
  max: 'already at its maximum',
  min: 'no set left to remove',
  noexercise: 'no planned exercise trains it directly',
  noplan: 'change it by hand',
}
const exName = id => (EXIDX[id] ? exerciseNameFor(EXIDX[id]) : id)

// Where a step comes from when it is not the user's answers (muscle-feedback.js `source`).
const SOURCE = {
  ramp: 'volume ramp: one set more',
  start: 'new mesocycle: back to the bottom of the band',
}

/**
 * The set changes closing this microcycle proposes — from the answers and the volume ramp, or,
 * closing a deload, the new mesocycle's start — each group switchable off. `skip` and `setSkip`
 * belong to the parent, which applies `feedbackPlan(S, { skip }).changes` on confirm.
 */
export function FeedbackAdjustments({ S, skip, setSkip }) {
  if (!adjustmentsOn(S)) return null
  const plan = feedbackPlan(S, { skip })
  if (plan.blocked === 'deload') return null
  // Nothing to say without programming unless the answers asked for something.
  if (plan.blocked === 'noplan' && !plan.groups.length) return null
  const toggle = key => setSkip(skip.includes(key) ? skip.filter(k => k !== key) : [...skip, key])
  return <>
    <h4 className="sec">{t(plan.kind === 'start' ? 'Volume of the new mesocycle' : 'Adjust sets by how you felt')}</h4>
    {plan.blocked === 'noplan' && <div className="small dim" style={{ marginBottom: 8 }}>
      {t('Without a microcycle programming (Plan ▸ Programming) the sets cannot be changed for you. This is what your feedback asks for:')}
    </div>}
    {plan.blocked === 'none'
      ? <div className="small dim" style={{ marginBottom: 14 }}>{t('No session of this microcycle has feedback, so its sets stay as they are.')}</div>
      : !plan.groups.length
        ? <div className="small dim" style={{ marginBottom: 14 }}>{t('Nothing to adjust: the sets stay as they are.')}</div>
        : <div className="list" style={{ display: 'flex', flexDirection: 'column', marginBottom: 6 }} data-testid="fb-adjustments">
          {plan.groups.map(g => {
            const on = !g.skipped && !g.capped
            const why = SOURCE[g.source] ? t(SOURCE[g.source])
              : g.signal.reasons.map(r => REASON[r.f][r.v]).filter(Boolean).map(x => t(x)).join(' · ')
            return <div key={g.key} className="item" role="checkbox" aria-checked={on} aria-disabled={g.capped}
              onClick={() => !g.capped && toggle(g.key)} style={{ alignItems: 'flex-start', opacity: g.capped ? 0.6 : 1 }}>
              <div className="grow">
                <div className="tt">{t(g.name)} · {t('{0} sets', signed(g.signal.step))}</div>
                <div className="ss">{why}{why && !g.skipped ? ' — ' : ''}{g.capped
                  ? t(CAPPED[g.capped] || CAPPED.max)
                  : g.skipped ? null : t('planned {0} → {1}', fmtNum(g.before), fmtNum(g.after))}</div>
                {on && g.changes.map((c, i) => <div key={i} className="ss capitalize">• {c.routineName || t('Routine')} · {exName(c.exId)}: {t('{0} → {1} sets', c.from, c.to)}</div>)}
              </div>
              {!g.capped && (on
                ? <Icon name="checkCircle" style={{ color: 'var(--acc)', flex: 'none' }} />
                : <span aria-hidden="true" style={{ flex: 'none', width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--label-3)' }} />)}
            </div>
          })}
        </div>}
    {plan.changes.length > 0 && <div className="small dim" style={{ marginBottom: 14 }}>
      {t('Only the number of sets changes. Weight, reps and progression stay as they are.')}
    </div>}
  </>
}
