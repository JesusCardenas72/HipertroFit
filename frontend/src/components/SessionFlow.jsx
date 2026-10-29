import { useMemo } from 'react'
import { useStore } from '../store/useStore.js'
import { exOr } from '../lib/exercises.js'
import { exerciseNameFor, t } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { modeOf, setLabel } from '../lib/history.js'
import { railItems, exerciseRecords, repMaxFor } from '../lib/session-view.js'
import { REP_CAP } from '../lib/onerm.js'
import Icon from './Icon.jsx'
import { Thumb } from './Media.jsx'

/* The exercise's two records and what its best estimate says it could lift for each rep count.
   Read from history only; nothing here is logged. */
function Records({ exId }) {
  const workouts = useStore(s => s.S.workouts)
  const unit = useStore(s => s.S.unit)
  const { maxWeight, maxReps } = useMemo(() => exerciseRecords({ workouts }, exId), [workouts, exId])
  const rm = useMemo(() => repMaxFor({ workouts }, exId), [workouts, exId])
  if (!maxWeight && !maxReps) return null
  return <>
    <div className="sf-recs">
      {maxWeight && <div className="sf-rec">
        <div className="k"><span>{t('Max weight')}</span><Icon name="dumbbell" /></div>
        <div className="d">{fmtDate(maxWeight.d, false, true)}</div>
        <div className="v">{fmtNum(maxWeight.w)} {unit} <small>({t('{0} reps', maxWeight.r)})</small></div>
      </div>}
      {maxReps && <div className="sf-rec">
        <div className="k"><span>{t('Max reps')}</span><Icon name="bolt" /></div>
        <div className="d">{fmtDate(maxReps.d, false, true)}</div>
        <div className="v">{t('{0} reps', maxReps.r)}{maxReps.w > 0 && <small> ({fmtNum(maxReps.w)} {unit})</small>}</div>
      </div>}
    </div>
    {rm.length > 0 && <div className="sf-rm">
      <div className="k">{t('Rep max @ {0}', unit)}</div>
      <div className="g">
        {rm.map(row => <span key={row.r} className={row.rough ? 'rough' : ''}
          title={row.rough ? t('Rough estimate past {0} reps', REP_CAP) : undefined}>
          {row.r} @ <b>{fmtNum(row.w)}</b>
        </span>)}
      </div>
    </div>}
  </>
}

/* The "Session" view: every exercise of the workout down one column, a rail of thumbnails at
   its side and a coloured bar joining the members of each superset (the dock's colours). The
   unit being worked is open — its exercises with every set — and the rest fold to a line; a tap
   on one moves the session there, exactly as tapping it in the dock does. The sets are the same
   ExerciseBlock the other views draw (`renderBlock`), so logging works the same in all of them. */
export default function SessionFlow({ entries, cur, renderBlock, onSelect, onToggleHead, headOpen, bindExRef }) {
  const rail = railItems(entries, cur)
  return <div className="sflow" data-testid="session-flow">
    {rail.map(item => {
      const entry = entries[item.idx]
      const ex = exOr(entry.id)
      const name = exerciseNameFor(ex)
      const doneCount = entry.sets.filter(s => s.done).length
      const next = entry.sets.find(s => !s.done) || entry.sets[entry.sets.length - 1]
      const reps = modeOf({ ...(entry.target || {}), id: entry.id }) === 'reps'
      const cls = 'sf-row ' + item.pos + (item.current ? ' open' : '') + (item.idx === cur ? ' cur' : '') + (item.done ? ' done' : '')
      const style = item.hue != null ? { '--ss': `hsl(${item.hue},70%,55%)` } : undefined
      return <div key={item.idx} className={cls} style={style} data-exidx={item.idx}
        ref={item.current ? el => bindExRef(entry, el) : undefined}>
        <button type="button" className="sf-rail" aria-label={name} aria-current={item.idx === cur ? 'step' : undefined}
          onClick={() => onSelect(item.idx)}>
          <Thumb ex={ex} />
          {item.done && <span className="sf-ok"><Icon name="check" /></span>}
        </button>
        <div className="sf-body">
          {item.current ? <div className="sf-card">
            <div className="sf-head">
              <button type="button" className="exhead-tg" aria-expanded={headOpen(item.idx)} onClick={() => onToggleHead(item.idx)}>
                <span>{name}</span>
                <Icon name={headOpen(item.idx) ? 'chevronUp' : 'chevronDown'} className="exhead-chev" />
              </button>
              {item.pos !== 'solo' && <Icon name="link" className="sf-link" />}
            </div>
            {/* The records belong to the exercise you are on; its partner keeps just its sets,
                so a superset does not open as two screens of numbers. */}
            {item.idx === cur && reps && <Records exId={entry.id} />}
            {renderBlock(item.idx)}
          </div> : <button type="button" className="sf-sum" onClick={() => onSelect(item.idx)}>
            <span className="sf-name">{name}</span>
            <span className="sf-meta">{doneCount}/{entry.sets.length}{next ? ' · ' + setLabel(entry.id, next, entry.target) : ''}</span>
          </button>}
        </div>
      </div>
    })}
  </div>
}
