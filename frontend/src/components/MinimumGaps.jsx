import { t } from '../lib/i18n.js'
import { minimumGaps } from '../lib/volume.js'
import Icon from './Icon.jsx'

// What a finished microcycle still lacks. Shown under the bars on Home's volume card once every
// planned session of the running block is done (MuscleVolumeCard): one tile per group that has a
// minimum, with the whole sets it still needs to reach it (lib/volume.js minimumGaps). An orange
// figure is short; a tile marked "at minimum" has got there. The figures are per group — a compound
// set also feeds the groups it trains alongside, so they are not added up.
export default function MinimumGaps({ vol }) {
  const gaps = minimumGaps(vol).filter(g => g.min > 0)
  const short = gaps.filter(g => g.remaining > 0).length
  return <>
    <div className="vol-hd"><h4 className="sec">{t('To reach the minimum')}</h4></div>
    <div className="muted small">
      {short ? t('Microcycle complete — sets still missing in {0} of {1} groups.', short, gaps.length)
        : t('Microcycle complete — every group reaches its minimum.')}
    </div>
    <div className="vol-need">
      {gaps.map(g => <div key={g.key} className={'vol-need-cell' + (g.remaining ? '' : ' met')}>
        <span className="nm" title={t(g.name)}>{t(g.short || g.name)}</span>
        {g.remaining
          ? <><b>{g.remaining}</b><span className="lb">{t('Sets')}</span></>
          : <span className="ok"><Icon name="check" />{t('At minimum')}</span>}
      </div>)}
    </div>
  </>
}
