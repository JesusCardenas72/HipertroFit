import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { loadOfWorkouts, MUSCLE_NAME } from '../lib/muscles.js'
import { cyclePosition } from '../lib/microcycle.js'
import { cycleVolume, groupVolume, plannedVolume } from '../lib/volume.js'
import BodyMap, { BodyMapLegend } from './BodyMap.jsx'
import VolumeGroupBars from './VolumeGroupBars.jsx'
import MinimumGaps from './MinimumGaps.jsx'
import CyclePicker, { useCycleChoice, CycleStatsLine } from './CyclePicker.jsx'
import Icon from './Icon.jsx'
import { logExtraSheet } from '../sheets.jsx'

// The muscle map from Stats, windowed on the microcycle instead of the week, over the
// effective-set bars for the same block. Same numbers as the Stats card by construction:
// both read cycleVolume and render VolumeGroupBars. The picker in the header turns it to a
// microcycle already behind; that one reads its log only — the plan is today's programming,
// which says nothing about what that block planned.
// Once the running block has every planned session done, the sets each group still needs for
// its minimum follow the bars (MinimumGaps).
export default function MuscleVolumeCard({ S }) {
  const [sel, setSel] = useState(null)
  const [cycle, pick, list] = useCycleChoice(S)
  const win = cycle.workouts
  const pos = cyclePosition(S)
  const vol = cycle.current ? cycleVolume(S) : { ...groupVolume(win), sessions: cycle.sessions }
  const planned = cycle.current ? plannedVolume(S) : null
  // The running block with all its planned sessions done: what it still lacks is settled.
  const complete = cycle.current && pos.complete
  const load = loadOfWorkouts(win, null)
  const sets = m => Math.round((load[m] || 0) * 10) / 10

  return <div className="card">
    <div className="row between" style={{ marginBottom: 6, flexWrap: 'nowrap', gap: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Volume')}</h2>
      <div className="row" style={{ gap: 8, flexWrap: 'nowrap', minWidth: 0 }}>
        <CyclePicker value={cycle} list={list} onPick={id => { pick(id); setSel(null) }} />
        {/* Sets done outside a session go in from here — this card is where they show up. */}
        <button className="iconbtn" onClick={logExtraSheet} aria-label={t('Log extra work')} title={t('Log extra work')}><Icon name="plus" /></button>
      </div>
    </div>
    {win.length > 0 && <CycleStatsLine cycle={cycle} style={{ marginBottom: 8 }} />}
    {win.length ? <>
      <BodyMap className="tappable" load={load} body={S.body} selected={sel}
        onMuscle={m => setSel(s => (s === m ? null : m))} />
      <BodyMapLegend />
      {sel && <div className="mrow" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 4, paddingTop: 10 }}>
        <span className="nm"><b>{t(MUSCLE_NAME[sel])}</b></span>
        <span className="v">{sets(sel) ? t('{0} sets', sets(sel)) : t('not trained')}</span>
      </div>}
      <VolumeGroupBars vol={vol} planned={planned} />
      {complete && <MinimumGaps vol={vol} />}
    </> : <div className="muted small">
      {!cycle.current ? t('Nothing was logged in this microcycle.')
        : pos.cycle > 0 || list.length > 1 ? t('New microcycle — volume starts from zero.') : t('Train a session to see your volume build up over the microcycle.')}
    </div>}
  </div>
}
