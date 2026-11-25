import { t } from '../lib/i18n.js'
import { dateLocale } from '../lib/i18n-core.js'
import { exOr } from '../lib/exercises.js'
import { platesFor, sideLabel, PLATE_CHOICES, platesOf, barFor } from '../lib/plates.js'
import { Row, Section } from './ui.jsx'
import NumField from './NumField.jsx'
import Icon from './Icon.jsx'

// The plate calculator (lib/plates.js): one line under a barbell set saying what goes on each
// side, and the Settings rows that say which bar and plates the gym has.

// Two decimals: a 1,25 kg plate is not a 1,3 (fmtNum rounds to one).
const fmtNum = n => Number(n).toLocaleString(dateLocale(), { maximumFractionDigits: 2 })

/** "Per side: 25 + 15 · bar 20 kg" for a plate-loaded exercise; nothing for anything else. */
export function PlatesLine({ S, exId, w, className = '' }) {
  const ex = exOr(exId)
  const load = platesFor(S, ex, w)
  if (!load || !(Number(w) > 0)) return null
  const u = S.unit
  const body = load.short
    ? t('Below the empty bar ({0})', fmtNum(load.bar) + ' ' + u)
    : !load.side.length
      ? t('Empty bar ({0})', fmtNum(load.bar) + ' ' + u)
      : <>{t('Per side:')} <b>{sideLabel(load.side, fmtNum)}</b> · {t('bar {0}', fmtNum(load.bar) + ' ' + u)}</>
  return <div className={'small dim plates-line ' + className} data-testid="plates-line" style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
    <Icon name="dumbbell" />
    <span>{body}{load.rest > 0 && !load.short && <span style={{ color: 'var(--orange)' }}> · {t('{0} per side has no plate', fmtNum(load.rest) + ' ' + u)}</span>}</span>
  </div>
}

/** Settings ▸ Bar and plates: the straight bar's weight and the plates on hand. */
export function PlatesSettings({ S, update }) {
  const u = S.unit === 'lb' ? 'lb' : 'kg'
  const have = platesOf(S)
  const toggle = p => update(s => {
    const cur = platesOf(s)
    const next = cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p]
    s.plateSet = next.length ? next.sort((a, b) => b - a) : cur
  })
  return <Section title={t('Bar and plates')} footer={t('Barbell sets show which plates go on each side. EZ and trap bars use their usual weight.')}>
    <Row icon="dumbbell" iconTint="var(--acc)" title={t('Barbell weight')}>
      <span className="row" style={{ gap: 6, alignItems: 'center' }}>
        <NumField className="timef" style={{ width: 64, textAlign: 'right' }} value={barFor(S, { eq: 'barbell' })}
          onChange={v => update(s => { s.barWeight = v > 0 ? v : null })} />
        <span className="dim">{u}</span>
      </span>
    </Row>
    <div style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 6 }} data-testid="plate-choices">
      {PLATE_CHOICES[u].map(p => <button key={p} type="button" className={'chip nocap' + (have.includes(p) ? ' on' : '')}
        aria-pressed={have.includes(p)} onClick={() => toggle(p)}>{fmtNum(p)}</button>)}
    </div>
  </Section>
}
