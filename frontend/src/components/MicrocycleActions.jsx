import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { STRATEGIES, cyclePosition, strategyOf, trainingSteps, microcycleLen, cycleEndOf } from '../lib/microcycle.js'
import { closeCycle, askCycleEnd } from '../lib/cycle-history.js'
import { mesoState, carriedBase } from '../lib/mesocycle.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { deloadControlSheet } from './Deload.jsx'
import { programSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// The three things you do to a microcycle as a whole, as one row of buttons: take a deload,
// close it and open another, lay it out. On Home they sit between the microcycle card and the
// volume card; Plan and Stats carry the same row so they are never more than a tab away.

const STRATEGY_ICON = { 'full-body': 'figureStrength', 'upper-lower': 'legs', ppl: 'pullup', custom: 'wrench' }

// Close the running microcycle and open the next one under `strategy`: the closed block goes
// to the log with its dates (lib/cycle-history.js) and the mesocycle goes on from it.
export function openNextCycle(strategy) {
  const before = strategyOf(useStore.getState().S)
  useStore.getState().update(s => { Object.assign(s, closeCycle(s, strategy)) })
  const after = useStore.getState().S
  useUI.getState().toast(t('New microcycle started — {0}', t(STRATEGIES.find(x => x.key === strategyOf(after)).name)))
  // A custom block is its own sequence, and a sequence that doesn't divide the new block
  // evenly would leave the last session of it short: either way the layout needs a look.
  const steps = trainingSteps(after.program).length
  if (strategy !== before && (strategy === 'custom' || !steps || microcycleLen(after) % steps)) programSheet()
}

/* ---------- close the microcycle and pick the strategy of the next one ---------- */
function CloseMicrocycle({ close }) {
  const S = useStore(s => s.S)
  const pos = cyclePosition(S)
  const meso = mesoState(S)
  const [pick, setPick] = useState(strategyOf(S))

  const confirm = () => { close(); openNextCycle(pick) }

  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="flag" />{t('Close microcycle')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Microcycle #{0} ({1} – today) ends here — {2} of {3} sessions done. The next one is #{4} of this mesocycle, with its volume at zero. Pick the training strategy it will follow.',
        meso.number, fmtDate(pos.start), pos.step, pos.len, carriedBase(S) + 1)}
    </div>
    <h4 className="sec">{t('Training strategy')}</h4>
    <div className="list" role="radiogroup" aria-label={t('Training strategy')} style={{ display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
      {STRATEGIES.map(x => <div key={x.key} className="item" {...tappable(() => setPick(x.key))} role="radio" aria-checked={pick === x.key}>
        <span className="lrow-i"><Icon name={STRATEGY_ICON[x.key]} /></span>
        <div className="grow">
          <div className="tt">{t(x.name)}</div>
          <div className="ss">{x.sessions ? t('{0} sessions / microcycle', x.sessions) : t('Counted from your sequence')}</div>
        </div>
        {pick === x.key && <Icon name="check" style={{ color: 'var(--acc)' }} />}
      </div>)}
    </div>
    <Button variant="primary" icon="flag" onClick={confirm}>{t('Close and start new microcycle')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
export const closeMicrocycleSheet = () => useUI.getState().openSheet(close => <CloseMicrocycle close={close} />)

/* ---------- the end of a microcycle's days: asked whether to open the next one ---------- */
function MicrocycleOver({ close }) {
  const S = useStore(s => s.S)
  const pos = cyclePosition(S)
  const meso = mesoState(S)
  const next = carriedBase(S) + 1
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <div className="deload-hero micro-hero"><Icon name="flag" /></div>
    <h3 style={{ marginBottom: 8 }}>{t('Microcycle #{0} is over', meso.number)}</h3>
    <div className="muted" style={{ marginBottom: 16, lineHeight: 1.5 }}>
      {t('{0} – {1} · {2} of {3} sessions. All its days, rest days included, have passed. Start microcycle #{4}?',
        fmtDate(pos.start), fmtDate(cycleEndOf(S) || todayISO()), pos.sessions, pos.len, next)}
    </div>
    <Button variant="primary" icon="flag" onClick={() => { close(); openNextCycle(strategyOf(S)) }}>{t('Start microcycle #{0}', next)}</Button>
    <div style={{ height: 8 }} />
    <Button icon="target" onClick={() => { close(); closeMicrocycleSheet() }}>{t('Change strategy')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Not yet')}</Button>
  </div>
}
export const microcycleOverSheet = () => useUI.getState().openSheet(close => <MicrocycleOver close={close} />, { kind: 'center' })

/**
 * Mounted once by the app shell: when the running microcycle's days are all gone by, asks
 * whether to open the next one — once a day, never over a session in progress. "Not yet"
 * leaves it open; the Home card keeps offering it, and so does the next session started.
 */
export function MicrocycleEndNotifier() {
  const S = useStore(s => s.S)
  const ask = !S.active && askCycleEnd(S)
  useEffect(() => {
    if (!ask) return
    // Not while the launch splash still covers the screen — asked behind it, it is missed.
    const iv = setInterval(() => {
      if (document.getElementById('splash')) return
      clearInterval(iv)
      // Marked as soon as it is shown: closing it by a swipe must not bring it back today.
      useStore.getState().update(s => { s.program = { ...s.program, endAsked: todayISO() } })
      microcycleOverSheet()
    }, 300)
    return () => clearInterval(iv)
  }, [ask])
  return null
}

export default function MicrocycleActions() {
  const S = useStore(s => s.S)
  const meso = mesoState(S)
  // Same condition as the microcycle card's welcome state: nothing to act on yet.
  if (!S.routines.length && !S.active) return null
  const deloading = meso.deload || meso.next
  // Each button: a coloured disc with the icon, the label under it (see .micro-btn in index.css).
  const btn = (cls, icon, label, onClick) => <button type="button" className={'micro-btn ' + cls} onClick={onClick}>
    <span className="disc"><Icon name={icon} /></span><span className="t">{label}</span>
  </button>
  return <div className="micro-actions">
    {btn('dl' + (deloading ? ' on' : ''), 'arrowDown', t('Deload'), deloadControlSheet)}
    {btn('close', 'flag', t('Close microcycle'), closeMicrocycleSheet)}
    {btn('prog', 'calendar', t('Programming'), programSheet)}
  </div>
}
