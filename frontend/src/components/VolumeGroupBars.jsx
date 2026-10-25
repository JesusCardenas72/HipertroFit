import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { VOLUME_GROUPS, VOLUME_TARGET, volumeStatus, volumeColor, targetOf } from '../lib/volume.js'

// Effective sets per muscle group for one microcycle, read against the 10–20 target band.
// Shared by Home and Stats so the two can never report different numbers for the same block.
//
// The bar is measured against the top of the band, not against the best-worked group: full
// width is the band's top (20 sets for most), so a short bar means "short of the target", not
// "trained less than legs".
//
// A split Back or Legs (Settings ▸ Training volume) shows its parts together under the whole
// group's name, indented, each with its own band next to the count — the parts are judged on
// different ranges, so the shared 10–20 in the legend no longer speaks for them.
const PARENT_NAME = { back: 'Back muscles', legs: 'Legs' }

export default function VolumeGroupBars({ vol, title }) {
  if (!vol) return null
  const split = VOLUME_GROUPS.some(g => g.parent)
  return <>
    {title !== false && <h4 className="sec" style={{ marginTop: 14 }}>{title || t('Effective sets')}</h4>}
    <div className="muted small" style={{ marginBottom: 6 }}>
      {t('Target {0}–{1} effective sets per muscle group each microcycle', VOLUME_TARGET.min, VOLUME_TARGET.max)}
      {split && <div>{t('Split groups show their own range.')}</div>}
    </div>
    {/* One grid for all rows, so name, bar and count line up as columns: the name and count
        columns size to their widest entry and every bar takes the same remaining width. */}
    <div className="vol-bars">
      {VOLUME_GROUPS.map((g, i) => {
        const v = Math.round((vol.groups[g.key] || 0) * 10) / 10
        const band = targetOf(g)
        const color = volumeColor(volumeStatus(v, band))
        const first = g.parent && (VOLUME_GROUPS[i - 1] || {}).parent !== g.parent
        return <div key={g.key} className={'vol-bar-row' + (g.parent ? ' sub' : '')}>
          {first && <span className="vol-group-h">{t(PARENT_NAME[g.parent])}</span>}
          <span className="nm">{t(g.short || g.name)}</span>
          <span className="bar"><i style={{ width: Math.min(100, Math.round(v / (band.max || 1) * 100)) + '%', background: color }} /></span>
          <span className="v" style={{ color }}>
            {t('{0} sts', fmtNum(v))}
            {g.target && <span className="rng">{band.min}–{band.max}</span>}
          </span>
        </div>
      })}
    </div>
    <div className="vol-legend">
      <span><i style={{ background: 'var(--orange)' }} />{t('under')} {VOLUME_TARGET.min}</span>
      <span><i style={{ background: 'var(--green)' }} />{t('in range')} {VOLUME_TARGET.min}–{VOLUME_TARGET.max}</span>
      <span><i style={{ background: 'var(--red)' }} />{t('over')} {VOLUME_TARGET.max}</span>
    </div>
    {vol.unrated > 0 && <div className="small" style={{ color: 'var(--yellow)', marginTop: 8 }}>
      {t('{0} of {1} sets without RIR — counted as effective', vol.unrated, vol.total)}
    </div>}
  </>
}
