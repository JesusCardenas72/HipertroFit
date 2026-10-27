import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { loadOfWorkouts, MUSCLE_NAME } from '../lib/muscles.js'
import { cycleWorkouts, cyclePosition } from '../lib/microcycle.js'
import { cycleVolume } from '../lib/volume.js'
import { microNumber } from '../lib/mesocycle.js'
import BodyMap, { BodyMapLegend } from './BodyMap.jsx'
import VolumeGroupBars from './VolumeGroupBars.jsx'
import Icon from './Icon.jsx'
import { logExtraSheet } from '../sheets.jsx'

// The muscle map from Stats, windowed on the microcycle instead of the week, over the
// effective-set bars for the same block. Same numbers as the Stats card by construction:
// both read cycleVolume and render VolumeGroupBars.
export default function MuscleVolumeCard({ S }) {
  const [sel, setSel] = useState(null)
  const win = cycleWorkouts(S)
  const pos = cyclePosition(S)
  const vol = cycleVolume(S)
  const load = loadOfWorkouts(win, null)
  const sets = m => Math.round((load[m] || 0) * 10) / 10

  return <div className="card">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Volume')}</h2>
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <span className="small muted">{t('Micro')} #{microNumber(S, pos.cycle)}</span>
        {/* Sets done outside a session go in from here — this card is where they show up. */}
        <button className="iconbtn" onClick={logExtraSheet} aria-label={t('Log extra work')} title={t('Log extra work')}><Icon name="plus" /></button>
      </div>
    </div>
    {win.length ? <>
      <BodyMap className="tappable" load={load} body={S.body} selected={sel}
        onMuscle={m => setSel(s => (s === m ? null : m))} />
      <BodyMapLegend />
      {sel && <div className="mrow" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 4, paddingTop: 10 }}>
        <span className="nm"><b>{t(MUSCLE_NAME[sel])}</b></span>
        <span className="v">{sets(sel) ? t('{0} sets', sets(sel)) : t('not trained')}</span>
      </div>}
      <VolumeGroupBars vol={vol} />
    </> : <div className="muted small">
      {pos.cycle > 0 ? t('New microcycle — volume starts from zero.') : t('Train a session to see your volume build up over the microcycle.')}
    </div>}
  </div>
}
