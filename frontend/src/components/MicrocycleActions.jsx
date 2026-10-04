import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { STRATEGIES, cyclePosition, strategyOf, closeMicrocycle, trainingSteps, microcycleLen } from '../lib/microcycle.js'
import { mesoState, restartMeso } from '../lib/mesocycle.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { deloadControlSheet } from './Deload.jsx'
import { programSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// The three things you do to a microcycle as a whole, as one row of buttons: take a deload,
// close it and open another, lay it out. On Home they sit between the microcycle card and the
// volume card; Plan and Stats carry the same row so they are never more than a tab away.

const STRATEGY_ICON = { 'full-body': 'figureStrength', 'upper-lower': 'legs', ppl: 'pullup', custom: 'wrench' }

/* ---------- close the microcycle and pick the strategy of the next one ---------- */
function CloseMicrocycle({ close }) {
  const S = useStore(s => s.S)
  const pos = cyclePosition(S)
  const [pick, setPick] = useState(strategyOf(S))

  const confirm = () => {
    const strategy = pick
    useStore.getState().update(s => {
      s.program = closeMicrocycle(s, strategy)
      s.meso = restartMeso(s)
    })
    close()
    const after = useStore.getState().S
    useUI.getState().toast(t('New microcycle started — {0}', t(STRATEGIES.find(x => x.key === strategy).name)))
    // A custom block is its own sequence, and a sequence that doesn't divide the new block
    // evenly would leave the last session of it short: either way the layout needs a look.
    const steps = trainingSteps(after.program).length
    if (strategy === 'custom' || !steps || microcycleLen(after) % steps) programSheet()
  }

  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="flag" />{t('Close microcycle')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Microcycle #{0} ends here — {1} of {2} sessions done. A new one starts from #1 with its volume at zero. Pick the training strategy it will follow.',
        pos.cycle + 1, Math.min(pos.step, pos.len), pos.len)}
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
