import { t } from '../lib/i18n.js'
import { pickerGaps, pickerGapList } from '../lib/picker-gaps.js'
import { volumeColor } from '../lib/volume.js'
import { usePersistedToggle } from '../lib/use-persisted-toggle.js'
import Icon from './Icon.jsx'

// Above the exercise picker's list: the muscle groups under their optimal range, the ones most
// short first, then the ones past it, the most over first (lib/picker-gaps.js). It reads the
// store on every render, so each set added while the picker is open moves the figures. `ctx` says
// where it was opened from: { routineId } for a routine being programmed, { adds } for a
// freestyle plan not started yet, nothing for the running session or a loose extra exercise.
// It folds to its header line (how many groups are under and over), remembered on this device.
export default function PickerGaps({ S, ctx }) {
  const [open, toggle] = usePersistedToggle('picker_gaps_open', true)
  const { basis, gaps } = pickerGaps(S, ctx)
  const { short, over } = pickerGapList(gaps)
  const tag = (g, n, status) => <span key={g.key} className="tag pg-tag" data-group={g.key}
    style={{ color: volumeColor(status), background: `color-mix(in srgb, ${volumeColor(status)} 14%, transparent)` }}>
    {t(g.short || g.name)}<b>{n}</b>
  </span>
  const fine = !short.length && !over.length
  return <div className="picker-gaps" data-testid="picker-gaps">
    <button type="button" className="pg-fold" aria-expanded={open} onClick={toggle}>
      <span className="small dim">{basis === 'plan' ? t('Microcycle programming') : t('This microcycle')}</span>
      {!open && !fine && <span className="small pg-count">
        {short.length > 0 && <span style={{ color: volumeColor('low') }}>{t('{0} under', short.length)}</span>}
        {over.length > 0 && <span style={{ color: volumeColor('high') }}>{t('{0} over', over.length)}</span>}
      </span>}
      <Icon name={open ? 'chevronUp' : 'chevronDown'} className="pg-chev" />
    </button>
    {open && fine && <div className="small" style={{ color: volumeColor('ok') }}>{t('Every group is in its optimal range')}</div>}
    {open && short.length > 0 && <>
      <div className="small pg-lbl">{t('Under the optimum · sets missing')}</div>
      <div className="pg-tags">{short.map(g => tag(g, '−' + g.remaining, 'low'))}</div>
    </>}
    {open && over.length > 0 && <>
      <div className="small pg-lbl">{t('Over the optimum · sets too many')}</div>
      <div className="pg-tags">{over.map(g => tag(g, '+' + g.excess, 'high'))}</div>
    </>}
  </div>
}
