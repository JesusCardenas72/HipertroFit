import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { useUI } from '../store/useUI.js'
import { burst, step, alive } from '../lib/confetti.js'
import { Button, Segmented, Stepper } from './ui.jsx'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate } from '../lib/format.js'

// How each state of lib/double-progress.js reads: label, colour and icon.
export const DP_STATE = {
  first: { label: 'Baseline', color: 'var(--label-2)', icon: 'flag' },
  climbing: { label: 'Climbing reps', color: 'var(--blue)', icon: 'chevronUp' },
  ready: { label: 'Ready to progress', color: 'var(--green)', icon: 'arrowUp' },
  fatigue: { label: 'Fatigue — no overload', color: 'var(--orange)', icon: 'bolt' },
  deload: { label: 'Deload', color: 'var(--red)', icon: 'arrowDown' },
  bodyweight: { label: 'Bodyweight', color: 'var(--teal)', icon: 'figureStrength' },
}

// Share of the range one set covers: the bottom rep already counts as a step in, so a set at
// the bottom shows a sliver instead of nothing and the top fills the bar.
const fill = (r, bottom, top) => (r < bottom ? 0 : Math.min(1, (r - bottom + 1) / (top - bottom + 1)))

/**
 * The picture of one exercise's double progression: every set of the last session placed on
 * the rep range, how much is left before the next step, and the climb at this weight.
 */
export function DoubleProgressMeter({ status, unit, compact = false, live = false }) {
  if (!status) return null
  const look = DP_STATE[status.state] || DP_STATE.climbing
  const { top, bottom, reps, weight } = status
  const segs = top - bottom + 1
  return <div className={'dpm' + (compact ? ' compact' : '')} style={{ '--dp': look.color }}>
    <div className="dpm-head">
      <span className="dpm-w">{weight > 0 ? fmtNum(weight) + ' ' + unit : t('Bodyweight')}</span>
      <span className="dpm-range">{live ? t('Last session') + ' · ' : ''}{t('Range {0}–{1}', bottom, top)}</span>
      <span className="dpm-state"><Icon name={look.icon} />{t(look.label)}</span>
    </div>
    {status.state === 'first'
      ? <div className="small dim">{t('Nothing logged yet — this session sets the baseline.')}</div>
      : <>
        <div className="dpm-bars" role="img" aria-label={t('Reps per set in the range {0}–{1}', bottom, top) + ': ' + reps.join(', ')}>
          {reps.map((r, i) => (
            <div className={'dpm-row' + (i >= status.planned ? ' extra' : '')} key={i}>
              <span className="dpm-n">{i + 1}</span>
              <div className="dpm-track" style={{ '--segs': segs }}>
                <div className={'dpm-fill' + (r < bottom ? ' under' : '')} style={{ width: (fill(r, bottom, top) * 100) + '%' }} />
              </div>
              <span className={'dpm-r' + (r >= top ? ' top' : r < bottom ? ' under' : '')}>{r}</span>
            </div>
          ))}
        </div>
        <div className="dpm-foot small">
          {status.state === 'ready' && (live ? t('Top of the range in every set — this session decides what to add.') : t('Top of the range in every set — the next session asks what to add.'))}
          {status.state === 'fatigue' && (live ? t('Reps fell set to set last time: today repeats the aim, no more reps or weight.') : t('Reps fell set to set: the next session repeats the aim, no more reps or weight.'))}
          {status.state === 'deload' && t('Stalled {0} sessions — the weight comes down.', status.stalls)}
          {status.state === 'bodyweight' && t('No load to add — reps, then sets, carry the progression.')}
          {status.state === 'climbing' && <>
            {t('{0} reps to the top', status.repsLeft)} · <b>{t('~{0} sessions to add weight', status.sessionsLeft)}</b>
            {status.stalls > 0 && <> · <span style={{ color: 'var(--orange)' }}>{t('stalled {0} of {1}', status.stalls, status.deloadAt)}</span></>}
          </>}
        </div>
        {!compact && status.history.length > 1 && <div className="dpm-climb" aria-label={t('Sessions at this weight')}>
          {status.history.map((h, i) => {
            const planned = h.reps.slice(0, status.planned)
            const avg = planned.length ? planned.reduce((a, r) => a + fill(r, bottom, top), 0) / status.planned : 0
            return <div className="dpm-col" key={i} title={fmtDate(h.d, true) + ' · ' + h.reps.join('/')}>
              <div className="dpm-colbar"><div className={'dpm-colfill' + (h.fatigued ? ' fat' : '')} style={{ height: Math.max(4, avg * 100) + '%' }} /></div>
              <span className="dpm-cold">{fmtDate(h.d, true)}</span>
            </div>
          })}
        </div>}
      </>}
    <div className="dpm-prog" aria-hidden="true"><div style={{ width: Math.round((status.progress || 0) * 100) + '%' }} /></div>
  </div>
}

/**
 * The semi-automatic step: the engine says the top of the range was earned, the athlete says
 * whether it becomes weight or another set, and how much.
 */
export function ProgressionChoice({ plan, unit, onChoose }) {
  const c = plan?.choice || {}
  const [type, setType] = useState('weight')
  const [kg, setKg] = useState(c.inc || 2.5)
  const [sets, setSets] = useState(1)
  if (!plan || plan.kind !== 'decide') return null
  const w = plan.weight || 0
  const preview = type === 'weight'
    ? t('{0} → {1} {2} · {3}×{4}', fmtNum(w), fmtNum(Math.round((w + (kg || 0)) * 10) / 10), unit, c.sets, c.reps)
    : t('{0} → {1} sets · {2} {3} × {4}', c.sets, c.sets + Math.max(1, Math.round(sets || 1)), fmtNum(w), unit, c.reps)
  return <div className="dpchoice">
    <div className="dpchoice-t"><Icon name="arrowUp" />{t('Time to progress')}</div>
    <div className="small dim" style={{ marginBottom: 10 }}>{t('Top of the rep range in every set with no drop between sets. What do you add this session?')}</div>
    <Segmented value={type} onChange={setType}
      options={[{ value: 'weight', label: t('Add weight'), icon: 'plate' }, { value: 'sets', label: t('Add a set'), icon: 'plus' }]} />
    <div className="row between" style={{ marginTop: 10, gap: 10 }}>
      {type === 'weight'
        ? <Stepper value={kg} step={c.inc || 2.5} onChange={setKg} unit={unit} label={t('How much')} />
        : <Stepper value={sets} step={1} decimal={false} onChange={setSets} label={t('How many sets')} />}
      <span className="dpchoice-prev">{preview}</span>
    </div>
    <div className="row" style={{ gap: 8, marginTop: 12 }}>
      <Button className="grow" onClick={() => onChoose({ type: 'keep' })}>{t('Keep for now')}</Button>
      <Button className="grow" variant="primary" icon="check"
        disabled={type === 'weight' ? !(kg > 0) : !(sets >= 1)}
        onClick={() => onChoose(type === 'weight' ? { type, amount: kg } : { type, amount: Math.round(sets) })}>{t('Apply')}</Button>
    </div>
  </div>
}

const reducedMotion = () => {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch (e) { return false }
}

/**
 * A one-shot confetti explosion over the whole screen: a burst from the middle, where the window
 * pops up, and one from each bottom corner. Drawn on a canvas portalled to <body> — the modal box
 * is transformed, and a fixed element inside a transform is fixed to the box, not the screen.
 * Pointer-transparent, gone when the last piece has fallen, and skipped under reduced motion.
 */
export function Confetti() {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext?.('2d')
    if (!ctx || reducedMotion()) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = window.innerWidth, H = window.innerHeight
    canvas.width = W * dpr; canvas.height = H * dpr
    ctx.scale(dpr, dpr)
    let ps = [
      ...burst(90, W / 2, H * 0.52, { power: 1.05 }),
      ...burst(45, W * 0.04, H, { power: 1.45 }),
      ...burst(45, W * 0.96, H, { power: 1.45 }),
    ]
    let raf = 0, last = performance.now()
    const frame = now => {
      const dt = Math.min(3, (now - last) / (1000 / 60))
      last = now
      ctx.clearRect(0, 0, W, H)
      ps = ps.map(p => step(p, dt)).filter(p => alive(p, H))
      for (const p of ps) {
        ctx.save()
        ctx.globalAlpha = Math.min(1, p.life * 1.6)
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.scale(1, Math.cos(p.tilt))
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }
      if (ps.length) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])
  if (typeof document === 'undefined') return null
  return createPortal(<canvas ref={ref} className="confetti" aria-hidden="true" />, document.body)
}

/**
 * "Time to progress" as its own animated window: it pops in over the session with confetti and
 * asks the same question as ProgressionChoice. Locked — tapping outside does not lose the
 * decision; "Keep for now" is the way out. The sound is the opener's to play (it knows the
 * Sounds setting and whether this is a live session).
 */
export function progressionSheet({ plan, unit, onChoose, celebrate = true }) {
  const ui = useUI.getState()
  if (!ui.openSheet) return null
  let handle = null
  handle = ui.openSheet(close => <div className="dpcele">
    {celebrate && <Confetti />}
    <div className="dpcele-badge" aria-hidden="true"><Icon name="sparkles" /></div>
    <ProgressionChoice plan={plan} unit={unit} onChoose={choice => { close(); onChoose(choice) }} />
  </div>, { kind: 'center', locked: true })
  return handle
}
