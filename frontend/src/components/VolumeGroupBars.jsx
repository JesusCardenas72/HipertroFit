import { Fragment, useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import Icon from './Icon.jsx'
import { VOLUME_GROUPS, volumeMethod, volumeStatus, volumeColor, targetOf, groupProgress, cycleExecution, minimumGaps, volumeVerdict, groupExecution } from '../lib/volume.js'
import ZoneBar from './ZoneBar.jsx'
import { VERDICT } from './volume-verdict.js'
import { glyphOfMuscle } from '../lib/glyphs.js'
import { useStore } from '../store/useStore.js'
import { effortOf } from '../lib/history.js'

// Effective sets per muscle group for one microcycle, read against each group's target band.
// Shared by Home and Stats so the two can never report different numbers for the same block, and
// by the Programming sheet (`isPlan`, where `vol` is the plan itself and nothing else counts).
//
// Each group is three lines: its name, with the share of its volume already executed right beside
// it (of its plan, or of its minimum without one — groupExecution); one line that says where the
// group stands (volumeVerdict) with the figures at its right (done / planned · band); then the bar
// across the full width.
//
// The bar is components/ZoneBar.jsx: the band's three zones as a tinted track, one block per set
// over it, the sets done filled in the colour of the group's status and those the microcycle still
// plans (`planned`, plannedVolume) striped after them, in red when the plan goes past the maximum.
//
// The verdict reads minimumGaps over `ahead` (plannedAhead, the volume still to come; empty for a
// block already behind): the sets a group will still need for its minimum once that is done, or
// those it will end up past its optimal maximum.
//
// A split Back or Legs (Settings ▸ Training volume) shows its parts together under the whole
// group's name, indented, each with its own band — the parts are judged on different ranges.
const PARENT_NAME = { back: 'Back muscles', legs: 'Legs' }
const PEEK_HOLD_MS = 200
// What the percentage beside a group's name is read against.
const EXEC_OF = { plan: 'Executed of planned', min: 'Done of the minimum', max: 'Done of the optimal maximum' }

// The artwork of a group: the first of its muscles that has a picture (lib/glyphs.js).
const groupGlyph = g => {
  for (const m of g.muscles || []) { const k = glyphOfMuscle(m); if (k) return k }
  return null
}

// Holding a name that isn't shown whole — cut off with an ellipsis, or abbreviated (`short`) —
// opens it: the figures beside it fold away and the full name slides out, until the finger
// lifts. Names shown whole do nothing. Returns the row key being peeked at and the handlers.
function usePeek() {
  const [peek, setPeek] = useState(null)
  const timer = useRef(0)
  const stop = () => { clearTimeout(timer.current); setPeek(null) }
  useEffect(() => () => clearTimeout(timer.current), [])
  const bind = (key, abbreviated) => ({
    onPointerDown: e => {
      const el = e.currentTarget
      if (!abbreviated && el.scrollWidth <= el.clientWidth + 1) return
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setPeek(key), PEEK_HOLD_MS)
    },
    onPointerUp: stop, onPointerCancel: stop, onPointerLeave: stop,
    onContextMenu: e => e.preventDefault(),
  })
  return [peek, bind]
}

export default function VolumeGroupBars({ vol, title, planned, ahead, isPlan }) {
  const [info, setInfo] = useState(false)
  const [peek, bindPeek] = usePeek()
  if (!vol) return null
  const plan = planned && planned.total > 0 ? planned : null
  const gaps = Object.fromEntries(minimumGaps(vol, ahead).map(g => [g.key, g]))
  const exec = plan && cycleExecution(vol, plan)
  return <>
    {/* The how-to-read text (target band, split ranges, colour key) folds behind the info icon
        so the rows get the room; the execution line and any warning stay in view. */}
    <div className="vol-hd">
      {title !== false ? <h4 className="sec">{title || t('Effective sets')}</h4> : <span />}
      <button className={'iconbtn vol-info' + (info ? ' on' : '')} onClick={() => setInfo(v => !v)}
        aria-expanded={info} aria-label={t('How to read this')} title={t('How to read this')}><Icon name="info" /></button>
    </div>
    {info && <div className="vol-help small">
      <div>{volumeMethod() === 'simple'
        ? t('Each muscle group has its own target range of effective sets per microcycle, set by its priority (Settings ▸ Training volume).')
        : t('Each muscle group has its own target range of effective sets per microcycle: minimum effective to maximum adaptive volume.')}</div>
      <div className="vol-legend">
        <span><i className="zone low" />{t('under the minimum')}</span>
        <span><i className="zone ok" />{t('in range')}</span>
        <span><i className="zone high" />{t('over the maximum')}</span>
        {plan && <span><i className="plan" />{t('planned, to do')}</span>}
      </div>
      <div>{t('Each block is one set. The tint behind it is the zone it falls in; filled blocks are the sets done.')}</div>
      <div>{plan
        ? t('The percentage beside each group is the share of its planned volume already executed.')
        : t('The percentage beside each group is the share of its minimum already done.')}</div>
      <div>{t('The line under each group says how many sets it still needs for its minimum, counting what is still planned, or how many it will end up past its optimal maximum.')}</div>
    </div>}
    {exec && <div className="vol-exec small">
      {t('Executed {0} of {1} planned sets', exec.done, exec.planned)} <b>{exec.pct}%</b>
    </div>}
    {/* Each row: the name, the figures under it on a line of their own, then the bar across the whole width. */}
    <div className="vol-bars">
      {VOLUME_GROUPS.map((g, i) => {
        const band = targetOf(g)
        const p = groupProgress(g, vol, plan)
        const v = p.done
        const color = volumeColor(volumeStatus(v, band))
        const first = g.parent && (VOLUME_GROUPS[i - 1] || {}).parent !== g.parent
        const left = (ahead && ahead.groups[g.key]) || 0
        const verdict = volumeVerdict(gaps[g.key], { done: v, left, max: band.max, isPlan })
        const [say, sayColor] = VERDICT[verdict.kind]
        const ex = groupExecution(p)
        return <Fragment key={g.key}>
          {first && <span className="vol-group-h">{t(PARENT_NAME[g.parent])}</span>}
          <div className={'vol-bar-row' + (g.parent ? ' sub' : '') + (peek === g.key ? ' peek' : '')}>
            <div className="vol-name">
              <span className="nm" title={t(g.name)} {...bindPeek(g.key, !!g.short && t(g.short) !== t(g.name))}>{t(peek === g.key ? g.name : (g.short || g.name))}</span>
              {/* The share of the group's volume already executed, right beside its name: of its plan,
                  or of its minimum when the microcycle plans nothing for it (groupExecution). */}
              {ex.pct != null && <span className="vol-pct" title={t(EXEC_OF[ex.of])}>{ex.pct}%</span>}
              {/* The group's muscle artwork, at the right end of its name. */}
              {groupGlyph(g) && <Icon name={groupGlyph(g)} className="vol-glyph" />}
            </div>
            <span className="v">
              <span className="say" style={{ color: sayColor }}>{say(verdict.n)}</span>
              {/* Right: effective sets done (/ planned) · the group's band. */}
              <span className="fig">
                <b style={{ color }}>{fmtNum(v)}</b>
                {plan && <span className="of" style={p.over ? { color: 'var(--red)' } : undefined}>{' / ' + fmtNum(p.planned)}</span>}
                <span className="sep">{' · '}</span>
                <span className="rng">{band.min}–{band.max}</span>
              </span>
            </span>
            <ZoneBar done={v} planned={plan ? p.planned : 0} band={band} color={color} over={p.over} />
          </div>
        </Fragment>
      })}
    </div>
    {plan && VOLUME_GROUPS.some(g => groupProgress(g, vol, plan).over) && <div className="small" style={{ color: 'var(--red)', marginTop: 8 }}>
      {t('The plan goes past the optimal maximum in some groups — it should stay below it.')}
    </div>}
    {vol.unrated > 0 && <div className="small" style={{ color: 'var(--yellow)', marginTop: 8 }}>
      {t('{0} of {1} sets without RIR — counted as effective', vol.unrated, vol.total)}
      <LogRirNudge />
    </div>}
  </>
}

// With the effort column switched off every set is counted as effective on trust: the panel offers
// to turn it on, right where the doubt is shown. Nothing when the profile already logs effort.
function LogRirNudge() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  if (effortOf(S) !== 'none') return null
  return <div style={{ marginTop: 6 }}>
    <span className="dim">{t('Log RIR on each set so only the sets close to failure count.')} </span>
    <button className="chip nocap on" style={{ padding: '2px 10px', fontSize: 12 }} data-testid="log-rir"
      onClick={() => update(s => { s.effort = 'rir'; delete s.showRir })}>{t('Log RIR')}</button>
  </div>
}
