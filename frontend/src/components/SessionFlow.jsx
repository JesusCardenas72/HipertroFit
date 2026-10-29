import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { exerciseNameFor, t } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { modeOf } from '../lib/history.js'
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
  // Folded to its title by default; once opened it stays open from one exercise to the next
  // for the rest of the visit (UI state, not saved).
  const rmOpen = useUI(s => !!s.sessionRepMaxOpen)
  const toggleRm = () => useUI.setState(s => ({ sessionRepMaxOpen: !s.sessionRepMaxOpen }))
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
      <button type="button" className="k" aria-expanded={rmOpen} onClick={toggleRm}>
        <span>{t('Rep max @ {0}', unit)}</span><Icon name={rmOpen ? 'chevronUp' : 'chevronDown'} />
      </button>
      {rmOpen && <div className="g">
        {rm.map(row => <span key={row.r} className={row.rough ? 'rough' : ''}
          title={row.rough ? t('Rough estimate past {0} reps', REP_CAP) : undefined}>
          {row.r} @ <b>{fmtNum(row.w)}</b>
        </span>)}
      </div>}
    </div>}
  </>
}

/* The "Session" view: every exercise of the workout as a tab down the left — its thumbnail, with
   a coloured bar joining the members of each superset (the dock's colours) — and beside them the
   panel of the unit being worked, joined to its tabs. The tabs stay on screen while the panel
   scrolls; a tap on one moves the session there, as tapping it in the dock does, and the panel
   slides in from the side of the session it comes from. The sets are the same ExerciseBlock the
   other views draw (`renderBlock`), so logging works the same in all of them. */
export default function SessionFlow({ entries, cur, renderBlock, onSelect, onToggleHead, headOpen, bindExRef }) {
  const rail = railItems(entries, cur)
  const members = rail.filter(item => item.current).map(item => item.idx)
  const open = rail.find(item => item.current)
  const unit = open?.unit ?? 0
  // Which way the panel comes in: from below moving on through the session, from above going back.
  const lastUnit = useRef(unit)
  const dir = unit === lastUnit.current ? 0 : unit > lastUnit.current ? 1 : -1
  useEffect(() => { lastUnit.current = unit }, [unit])

  // The tabs stick under the session header, whose height changes as it folds; the panel is at
  // least as tall as the tabs, so the open tab always has a panel edge to join.
  const railEl = useRef(null)
  const [geom, setGeom] = useState({ top: 0, rail: 0 })
  useLayoutEffect(() => {
    const head = document.querySelector('.wtop')
    const measure = () => {
      const next = { top: head ? head.offsetHeight : 0, rail: railEl.current ? railEl.current.scrollHeight : 0 }
      setGeom(g => (g.top === next.top && g.rail === next.rail ? g : next))
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (head) ro?.observe(head)
    if (railEl.current) ro?.observe(railEl.current)
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
  }, [entries.length])
  // A long session's tabs scroll on their own: keep the one being worked in sight.
  useEffect(() => {
    const box = railEl.current
    const tab = box?.querySelector('.sf-tab.cur')
    if (!box || !tab) return
    if (tab.offsetTop < box.scrollTop) box.scrollTop = tab.offsetTop - 4
    else if (tab.offsetTop + tab.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = tab.offsetTop + tab.offsetHeight - box.clientHeight + 4
  }, [cur])

  return <div className="sflow" data-testid="session-flow"
    style={{ '--sf-top': geom.top + 'px', '--sf-rail': geom.rail + 'px' }}>
    <nav className="sf-tabs" ref={railEl} aria-label={t('Exercises')}>
      {rail.map((item, k) => {
        const ex = exOr(entries[item.idx].id)
        const name = exerciseNameFor(ex)
        // The open tabs are one piece with the panel: the first and the last of them round off
        // and curve into its edge (.sf-cn), the ones between run straight on.
        const top = item.current && !rail[k - 1]?.current
        const bot = item.current && !rail[k + 1]?.current
        const cls = 'sf-tab ' + item.pos + (item.current ? ' on' : '') + (top ? ' on-top' : '') + (bot ? ' on-bot' : '')
          + (item.idx === cur ? ' cur' : '') + (item.done ? ' done' : '')
        return <button key={item.idx} type="button" className={cls} data-exidx={item.idx} aria-label={name} title={name}
          aria-current={item.idx === cur ? 'step' : undefined}
          style={item.hue != null ? { '--ss': `hsl(${item.hue},70%,55%)` } : undefined}
          onClick={() => onSelect(item.idx)}>
          {top && k > 0 && <i className="sf-cn t" />}
          <span className="sf-th"><Thumb ex={ex} /></span>
          {item.done && <span className="sf-ok"><Icon name="check" /></span>}
          {bot && <i className="sf-cn b" />}
        </button>
      })}
    </nav>
    {/* Square where the open tab meets it at the very top, so the two read as one shape. */}
    <div key={members.join(',')} className={'sf-panel' + (rail[0]?.current ? ' flush' : '')} data-dir={dir}
      style={open?.hue != null ? { '--ss': `hsl(${open.hue},70%,55%)` } : undefined}>
      {members.map(idx => {
        const entry = entries[idx]
        const name = exerciseNameFor(exOr(entry.id))
        const reps = modeOf({ ...(entry.target || {}), id: entry.id }) === 'reps'
        return <div key={idx} className={'sf-card' + (idx === cur ? ' cur' : '')} data-exidx={idx} ref={el => bindExRef(entry, el)}>
          <div className="sf-head">
            <button type="button" className="exhead-tg" aria-expanded={headOpen(idx)} onClick={() => onToggleHead(idx)}>
              <span>{name}</span>
              <Icon name={headOpen(idx) ? 'chevronUp' : 'chevronDown'} className="exhead-chev" />
            </button>
            {members.length > 1 && <Icon name="link" className="sf-link" />}
          </div>
          {/* The records belong to the exercise you are on; its partner keeps just its sets,
              so a superset does not open as two screens of numbers. */}
          {idx === cur && reps && <Records exId={entry.id} />}
          {renderBlock(idx)}
        </div>
      })}
    </div>
  </div>
}
