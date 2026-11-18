import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { volumeColor, volumeStatus } from '../lib/volume.js'
import { glyphOfMuscle } from '../lib/glyphs.js'
import Icon from './Icon.jsx'

// How a planned freestyle session moves the running microcycle's volume, group by group
// (lib/free-plan.js, freePlanProjection). Each row reads "before → after", where `before` is
// where the block lands without this session (sets done plus what its own sessions still plan)
// and `after` where it lands with it, against the group's optimal range. The bar shows, from the
// left, the sets done, the sets still planned (striped) and this session's sets (blue), with
// ticks at the range's minimum and maximum.
//
// Only the groups the session touches are listed; the toggle opens the rest.
const groupGlyph = g => {
  for (const m of g.muscles || []) { const k = glyphOfMuscle(m); if (k) return k }
  return null
}
const pct = (n, scale) => Math.min(100, Math.max(0, n / scale * 100)) + '%'

export default function FreePlanVolume({ rows }) {
  const [all, setAll] = useState(false)
  const touched = rows.filter(r => r.added > 0)
  const shown = all ? rows : touched
  return <div className="free-vol">
    <div className="vol-hd">
      <h4 className="sec">{t('Microcycle volume')}</h4>
      {rows.length > touched.length && <button className="chip nocap" onClick={() => setAll(v => !v)}>
        {all ? t('Only the groups it trains') : t('Show all groups')}
      </button>}
    </div>
    <div className="vol-legend small" style={{ marginTop: 0, marginBottom: 8 }}>
      <span><i style={{ background: 'var(--label-2)' }} />{t('done')}</span>
      <span><i className="plan" />{t('still planned')}</span>
      <span><i style={{ background: 'var(--blue)' }} />{t('this session')}</span>
    </div>
    {!shown.length && <div className="muted small">{t('Add exercises to see how this session changes the volume of your microcycle.')}</div>}
    <div className="vol-bars">
      {shown.map(r => {
        const scale = Math.max(r.max * 1.15, r.after) || 1
        const color = volumeColor(r.status)
        return <div key={r.key} className={'vol-bar-row' + (r.parent ? ' sub' : '')}>
          <div className="vol-name">
            <span className="nm">{t(r.short || r.name)}</span>
            {groupGlyph(r) && <Icon name={groupGlyph(r)} className="vol-glyph" />}
          </div>
          <span className="v">
            <span className="fig">
              <span style={{ color: volumeColor(r.statusBefore) }}>{fmtNum(r.before)}</span>
              {r.added > 0 && <> → <b style={{ color }}>{fmtNum(r.after)}</b></>}
              <span className="sep">{' · '}</span>
              <span className="mx">{r.min}–{r.max}</span>
            </span>
            {r.added > 0 && <span className="need add">+{fmtNum(r.added)}</span>}
            <span className={'need st ' +(r.status === 'ok' ? 'met' : r.status === 'high' ? 'over' : '')}>
              {r.status === 'ok' ? <><Icon name="check" />{t('in range')}</>
                : r.status === 'high' ? t('{0} over the max', Math.ceil(r.after - r.max))
                  : t('{0} to the min', Math.ceil(r.min - r.after))}
            </span>
          </span>
          <span className="bar">
            <i className="add" style={{ width: pct(r.after, scale) }} />
            <i className="plan" style={{ width: pct(r.before, scale) }} />
            <i style={{ width: pct(r.done, scale), background: volumeColor(volumeStatus(r.done, r)) }} />
            {r.min > 0 && <b className="tick" style={{ left: pct(r.min, scale) }} />}
            <b className="tick max" style={{ left: pct(r.max, scale) }} />
          </span>
        </div>
      })}
    </div>
    {touched.some(r => r.over) && <div className="small" style={{ color: 'var(--red)', marginTop: 8 }}>
      {t('This session takes some groups past their optimal maximum.')}
    </div>}
  </div>
}
