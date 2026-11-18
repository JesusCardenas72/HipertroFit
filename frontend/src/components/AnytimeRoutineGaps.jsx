import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { anytimeRoutineGaps } from '../lib/volume.js'

// On the programming screen of a routine outside the sequence — one to train any time — the sets
// each group still needs for its minimum in the running microcycle, with this routine done on top
// of the plan (lib/volume.js anytimeRoutineGaps). Every set added here comes off the gap as it is
// programmed: the figure Home shows, struck through, then what is left after this routine. The
// groups it trains come first; the counts are per group and not to be added up.
export default function AnytimeRoutineGaps({ S, routine }) {
  const rows = anytimeRoutineGaps(S, routine)
    .sort((a, b) => (b.adds > 0) - (a.adds > 0))
  if (!rows.length) return null
  return <div className="card anytime-gaps" style={{ marginTop: 12 }} data-testid="anytime-gaps">
    <h2>{t('Sets missing this microcycle')}</h2>
    <div className="muted small" style={{ marginBottom: 6 }}>
      {t('This routine is outside the sequence: what each group still lacks for its minimum once it is done on top of the plan.')}
    </div>
    {rows.map(g => {
      const changed = g.before !== g.remaining
      return <div key={g.key} className={'mrow' + (g.adds > 0 ? '' : ' dim')} data-group={g.key}>
        <span className="nm">
          <b>{t(g.name)}</b>
          {g.adds > 0 && <span className="small dim">{' · ' + t('{0} here', fmtNum(g.adds))}</span>}
        </span>
        <span className="v">
          {changed && g.before > 0 && <s className="dim">{'+' + g.before}</s>}
          {changed && g.before > 0 && ' '}
          {g.excess
            ? <b style={{ color: 'var(--red)' }}>−{t('{0} sets', g.excess)}</b>
            : g.min > 0 && (g.remaining
              ? <b style={{ color: 'var(--orange)' }}>+{t('{0} sets', g.remaining)}</b>
              : <b style={{ color: 'var(--green)' }}>{t('Plan covers it')}</b>)}
        </span>
      </div>
    })}
  </div>
}
