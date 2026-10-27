import { Fragment, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import Icon from './Icon.jsx'
import { VOLUME_GROUPS, VOLUME_TARGET, volumeStatus, volumeColor, targetOf, groupProgress, cycleExecution } from '../lib/volume.js'

// Effective sets per muscle group for one microcycle, read against the 10–20 target band.
// Shared by Home and Stats so the two can never report different numbers for the same block.
//
// Each group is two lines: its name with the figures, then the bar on its own across the full
// width, so the figures never squeeze the bar. The bar is measured against the top of the band, not against the best-worked group: full
// width is the band's top (20 sets for most), so a short bar means "short of the target", not
// "trained less than legs".
//
// A split Back or Legs (Settings ▸ Training volume) shows its parts together under the whole
// group's name, indented, each with its own band next to the count — the parts are judged on
// different ranges, so the shared 10–20 in the legend no longer speaks for them.
//
// With `planned` (plannedVolume, the live Home/Stats panel) each row also reads the log against
// the plan: the empty part of the bar shows, striped, the sets the microcycle still plans, and
// past the stripes the plain track left up to the optimal maximum — the gap the plan keeps below
// the band's top. A plan that reaches past that top is painted red. The count says the effective
// sets done, the planned figure and the share executed. Without it (the Programming sheet, where
// `vol` already is the plan) the bars read as before.
const PARENT_NAME = { back: 'Back muscles', legs: 'Legs' }

export default function VolumeGroupBars({ vol, title, planned }) {
  const [info, setInfo] = useState(false)
  if (!vol) return null
  const split = VOLUME_GROUPS.some(g => g.parent)
  const plan = planned && planned.total > 0 ? planned : null
  const exec = plan && cycleExecution(vol, plan)
  const pctOf = n => Math.min(100, Math.round(n * 100)) + '%'
  return <>
    {/* The how-to-read text (target band, split ranges, colour key) folds behind the info icon
        so the rows get the room; the execution line and any warning stay in view. */}
    <div className="vol-hd">
      {title !== false ? <h4 className="sec">{title || t('Effective sets')}</h4> : <span />}
      <button className={'iconbtn vol-info' + (info ? ' on' : '')} onClick={() => setInfo(v => !v)}
        aria-expanded={info} aria-label={t('How to read this')} title={t('How to read this')}><Icon name="info" /></button>
    </div>
    {info && <div className="vol-help small">
      <div>{t('Target {0}–{1} effective sets per muscle group each microcycle', VOLUME_TARGET.min, VOLUME_TARGET.max)}</div>
      {split && <div>{t('Split groups show their own range.')}</div>}
      <div className="vol-legend">
        <span><i style={{ background: 'var(--orange)' }} />{t('under')} {VOLUME_TARGET.min}</span>
        <span><i style={{ background: 'var(--green)' }} />{t('in range')} {VOLUME_TARGET.min}–{VOLUME_TARGET.max}</span>
        <span><i style={{ background: 'var(--red)' }} />{t('over')} {VOLUME_TARGET.max}</span>
        {plan && <span><i className="plan" />{t('planned, to do')}</span>}
        {plan && <span><i className="gap" />{t('up to the optimal max')}</span>}
      </div>
      {plan && <div>{t('The full bar is the optimal maximum; the plan should stay below it.')}</div>}
    </div>}
    {exec && <div className="vol-exec small">
      {t('Executed {0} of {1} planned sets', exec.done, exec.planned)} <b>{exec.pct}%</b>
    </div>}
    {/* Each row: name and figures on one line, the bar under them across the whole width. */}
    <div className="vol-bars">
      {VOLUME_GROUPS.map((g, i) => {
        const band = targetOf(g)
        const p = groupProgress(g, vol, plan)
        const v = p.done
        const color = volumeColor(volumeStatus(v, band))
        const first = g.parent && (VOLUME_GROUPS[i - 1] || {}).parent !== g.parent
        const scale = band.max || 1
        return <Fragment key={g.key}>
          {first && <span className="vol-group-h">{t(PARENT_NAME[g.parent])}</span>}
          <div className={'vol-bar-row' + (g.parent ? ' sub' : '')}>
            <span className="nm">{t(g.short || g.name)}</span>
            <span className="v">
              <b style={{ color }}>{t(plan ? '{0} eff' : '{0} sts', fmtNum(v))}</b>
              {plan && <span className="pct">{p.pct == null ? '—' : p.pct + '%'}</span>}
              {plan
                ? <span className="rng" style={p.over ? { color: 'var(--red)' } : undefined}>
                  {t('plan {0} · max {1}', fmtNum(p.planned), band.max)}
                </span>
                : g.target && <span className="rng">{band.min}–{band.max}</span>}
            </span>
            <span className="bar">
              {/* Planned first, under the done fill: only the part not yet trained shows. */}
              {plan && p.planned > 0 && <i className={'plan' + (p.over ? ' over' : '')} style={{ width: pctOf(p.planned / scale) }} />}
              <i style={{ width: pctOf(v / scale), background: color }} />
            </span>
          </div>
        </Fragment>
      })}
    </div>
    {plan && VOLUME_GROUPS.some(g => groupProgress(g, vol, plan).over) && <div className="small" style={{ color: 'var(--red)', marginTop: 8 }}>
      {t('The plan goes past the optimal maximum in some groups — it should stay below it.')}
    </div>}
    {vol.unrated > 0 && <div className="small" style={{ color: 'var(--yellow)', marginTop: 8 }}>
      {t('{0} of {1} sets without RIR — counted as effective', vol.unrated, vol.total)}
    </div>}
  </>
}
