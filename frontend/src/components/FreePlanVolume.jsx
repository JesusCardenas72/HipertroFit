import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { volumeColor, volumeStatus, groupExecution } from '../lib/volume.js'
import { glyphOfMuscle } from '../lib/glyphs.js'
import Icon from './Icon.jsx'
import ZoneBar from './ZoneBar.jsx'
import { VERDICT } from './volume-verdict.js'

// How a planned freestyle session moves the running microcycle's volume, group by group
// (lib/free-plan.js, freePlanProjection), drawn like every other volume panel (VolumeGroupBars):
// the name with the share of the group's volume already executed beside it, a line that says where
// the group lands with this session, the figures "before → after · band" at its right, and the
// zoned bar (ZoneBar) — the sets done, the sets still planned (striped) and this session's sets
// (blue). `before` is where the block lands without this session (sets done plus what its own
// sessions still plan) and `after` where it lands with it.
//
// Only the groups the session touches are listed; the toggle opens the rest.
const groupGlyph = g => {
  for (const m of g.muscles || []) { const k = glyphOfMuscle(m); if (k) return k }
  return null
}

// Where the group lands with this session, in the words every volume panel uses.
const verdictOf = r => r.after > r.max ? VERDICT.over[0](Math.ceil(r.after - r.max))
  : r.after < r.min ? VERDICT.short[0](Math.ceil(r.min - r.after)) : VERDICT.ok[0]()

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
      <span><i className="zone low" />{t('under the minimum')}</span>
      <span><i className="zone ok" />{t('in range')}</span>
      <span><i className="zone high" />{t('over the maximum')}</span>
      <span><i className="plan" />{t('still planned')}</span>
      <span><i className="add" />{t('this session')}</span>
    </div>
    {!shown.length && <div className="muted small">{t('Add exercises to see how this session changes the volume of your microcycle.')}</div>}
    <div className="vol-bars">
      {shown.map(r => {
        const band = { min: r.min, max: r.max }
        // Of the plan while the block still plans sets for the group, else of its minimum.
        const ex = groupExecution({ done: r.done, planned: r.ahead > 0 ? r.before : 0, min: r.min, max: r.max })
        return <div key={r.key} className={'vol-bar-row' + (r.parent ? ' sub' : '')}>
          <div className="vol-name">
            <span className="nm">{t(r.short || r.name)}</span>
            {ex.pct != null && <span className="vol-pct">{ex.pct}%</span>}
            {groupGlyph(r) && <Icon name={groupGlyph(r)} className="vol-glyph" />}
          </div>
          <span className="v">
            <span className="say" style={{ color: volumeColor(r.status) }}>{verdictOf(r)}</span>
            <span className="fig">
              <span style={{ color: volumeColor(r.statusBefore) }}>{fmtNum(r.before)}</span>
              {r.added > 0 && <> → <b style={{ color: volumeColor(r.status) }}>{fmtNum(r.after)}</b>
                <span className="added">{' +' + fmtNum(r.added)}</span></>}
              <span className="sep">{' · '}</span>
              <span className="rng">{r.min}–{r.max}</span>
            </span>
          </span>
          <ZoneBar done={r.done} planned={r.before} after={r.after} band={band}
            color={volumeColor(volumeStatus(r.done, band))} />
        </div>
      })}
    </div>
    {touched.some(r => r.over) && <div className="small" style={{ color: 'var(--red)', marginTop: 8 }}>
      {t('This session takes some groups past their optimal maximum.')}
    </div>}
  </div>
}
