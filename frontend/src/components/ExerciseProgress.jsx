import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { setLabel } from '../lib/history.js'
import { fmtNum, fmtDate } from '../lib/format.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { e1rmSeries, best1RM } from '../lib/onerm.js'
import { exerciseProgress } from '../lib/exercise-progress.js'
import LineChart from './LineChart.jsx'
import { Segmented } from './ui.jsx'

// One exercise's progress curve in a sheet — Stats' "Exercise progress" card for the exercise in
// front of you, opened from its tools in a workout: the best set of every session (or the
// estimated 1RM), the last five sessions under it and the best so far.
function ExerciseProgress({ id }) {
  const S = useStore(s => s.S)
  const [metric, setMetric] = useState('top')
  const prog = useMemo(() => exerciseProgress(S.workouts, id), [S.workouts, id])
  // Memoised: LineChart drops its hover whenever its points change identity.
  const e1 = useMemo(() => (prog.mode === 'reps' ? e1rmSeries(S, id).map(p => ({ t: p.t, y: p.y, d: p.d })) : []), [S, id, prog.mode])
  const top = useMemo(() => prog.points.map(p => ({ t: p.t, y: p.y, d: p.d })), [prog])
  const onE1 = metric === 'e1rm' && e1.length > 0
  const unit = prog.mode === 'cardio' ? 'km/h' : prog.mode === 'time' ? 's' : prog.repsOnly ? t('reps') : S.unit
  const e1Best = onE1 ? best1RM(S, id) : null
  return <div className="exprog">
    <h3 className="capitalize">{exerciseNameFor(exOr(id))}</h3>
    {prog.points.length ? <>
      {e1.length > 0 && <Segmented className="seg-range" value={onE1 ? 'e1rm' : 'top'} onChange={setMetric}
        options={[{ value: 'top', label: t('Top set') }, { value: 'e1rm', label: t('Est. 1RM') }]} />}
      <div className="chart"><LineChart points={onE1 ? e1 : top} h={170} unit={onE1 ? S.unit : unit} color="var(--blue)" /></div>
      <div className="small dim" style={{ marginTop: 8 }}>
        {onE1 ? t('Estimated 1RM per workout') : prog.mode === 'cardio' ? t('Top speed per workout') : prog.mode === 'time' ? t('Longest hold per workout') : prog.repsOnly ? t('Most reps in a set per workout') : t('Best set weight per workout')}
        {' · '}{t('Best:')} <b className="accent">{fmtNum(onE1 ? e1Best.est : prog.best)} {onE1 ? S.unit : unit}</b>
      </div>
      <div style={{ marginTop: 8 }}>{prog.points.slice(-5).reverse().map((p, i) => (
        <div key={i} className="row between small" style={{ padding: '6px 0', borderBottom: 'var(--hair) solid var(--sep)' }}>
          <span className="muted">{fmtDate(p.d, true)}</span><span>{p.sets.map(s => setLabel(id, s, p.target)).join('  ')}</span>
        </div>
      ))}</div>
    </> : <div className="muted small">{t('Finish your first workout to see progress curves here.')}</div>}
  </div>
}

export const exerciseProgressSheet = id => useUI.getState().openSheet(() => <ExerciseProgress id={id} />)
