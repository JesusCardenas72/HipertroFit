import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { loadOfWorkouts, MUSCLE_NAME } from '../lib/muscles.js'
import { cyclePosition, workoutDaysOver } from '../lib/microcycle.js'
import { cycleVolume, groupVolume, plannedVolume, plannedAhead } from '../lib/volume.js'
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
// Each group's line of the bars always shows the sets it will still need for its minimum once what
// is still planned is done. Once the running block has every planned session done, or its scheduled
// workout days are over, MinimumGaps sums them up under the bars. A running block with a plan shows
// its bars from the start, before anything is logged: the gaps of the plan are already there to read.
export default function MuscleVolumeCard({ S }) {
  const [sel, setSel] = useState(null)
  const [cycle, pick, list] = useCycleChoice(S)
  const win = cycle.workouts
  const pos = cyclePosition(S)
  const vol = cycle.current ? cycleVolume(S) : { ...groupVolume(win), sessions: cycle.sessions }
  const planned = cycle.current ? plannedVolume(S) : null
  const ahead = cycle.current ? plannedAhead(S) : { groups: {} }
  // Settled once every planned session is done, or the calendar has no workout days left for the
  // block: from then on the sets still missing are what the block will get from the calendar.
  const settled = cycle.current && (pos.complete || workoutDaysOver(S))
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
    </> : <div className="muted small">
      {!cycle.current ? t('Nothing was logged in this microcycle.')
        : pos.cycle > 0 || list.length > 1 ? t('New microcycle — volume starts from zero.') : t('Train a session to see your volume build up over the microcycle.')}
    </div>}
    {(win.length > 0 || (planned && planned.total > 0)) && <>
      <VolumeGroupBars vol={vol} planned={planned} ahead={ahead} />
      {settled && <MinimumGaps vol={vol} complete={pos.complete} />}
    </>}
  </div>
}
