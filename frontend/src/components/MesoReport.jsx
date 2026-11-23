import { useMemo } from 'react'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { fmtNum, fmtDate } from '../lib/format.js'
import { EXIDX } from '../lib/exercises.js'
import { latestMesoReport } from '../lib/meso-report.js'
import { volumeStatus, volumeColor } from '../lib/volume.js'
import { MEASURE_NAME, lengthUnit } from '../lib/measures.js'
import { goalLabel } from '../lib/effort.js'

// The mesocycle report (lib/meso-report.js): a card in Stats with the headline, and the sheet with
// everything — volume per group per microcycle, effort against the target, strength, body.

const signed = (n, digits) => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmtNum(Math.abs(n), digits)
const nameOf = id => (EXIDX[id] ? exerciseNameFor(EXIDX[id]) : id)
const span = r => fmtDate(r.start, true) + ' – ' + (r.running ? t('today') : fmtDate(r.end, true))

function Section({ title, children }) {
  return <>
    <h4 className="sec">{title}</h4>
    <div className="sect-b" style={{ marginBottom: 12 }}>{children}</div>
  </>
}
const Line = ({ label, value, color }) => <div className="lrow">
  <span className="lrow-m"><span className="lrow-t capitalize">{label}</span></span>
  <span className="lrow-v" style={color ? { color } : undefined}>{value}</span>
</div>

function MesoReportSheet() {
  const S = useStore(s => s.S)
  const r = useMemo(() => latestMesoReport(S), [S])
  if (!r) return <div className="muted">{t('Finish your first workout to see progress curves here.')}</div>
  const u = S.unit, lu = lengthUnit(S)
  return <>
    <h3>{t(r.running ? 'Mesocycle in progress' : 'Last mesocycle')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {span(r)} · {t('{0} loading microcycles', r.micros)}{r.deload ? ' + ' + t('deload') : ''}
    </div>
    <Section title={t('Sessions')}>
      <Line label={t('Done of planned')} value={`${r.sessions} / ${r.planned}${r.adherence != null ? ' · ' + r.adherence + ' %' : ''}`}
        color={r.adherence >= 90 ? 'var(--green)' : r.adherence >= 70 ? 'var(--orange)' : 'var(--red)'} />
    </Section>
    {r.groups.length > 0 && <Section title={t('Effective sets per microcycle')}>
      {r.groups.map(g => <Line key={g.key} label={t(g.name)}
        value={<>{g.sets.map((v, i) => <span key={i} style={{ color: volumeColor(volumeStatus(v, g.band)) }}>{i ? ' · ' : ''}{fmtNum(v)}</span>)}
          <span className="dim"> ({g.band.min}–{g.band.max})</span></>} />)}
    </Section>}
    {r.effort.some(e => e.avg != null) && <Section title={t('Effort')}>
      {r.effort.map((e, i) => <Line key={i} label={t('Microcycle') + ' #' + (i + 1)}
        value={e.avg == null ? '—' : <>{goalLabel(S, e.avg)}{e.goal != null && <span className="dim"> · {t('target')} {goalLabel(S, e.goal)}</span>}</>} />)}
    </Section>}
    {r.strength.length > 0 && <Section title={t('Estimated 1RM, first to last microcycle')}>
      {r.strength.slice(0, 8).map(x => <Line key={x.id} label={nameOf(x.id)}
        value={`${fmtNum(x.from)} → ${fmtNum(x.to)} ${u} · ${signed(x.pct)} %`}
        color={x.pct > 0 ? 'var(--green)' : x.pct < 0 ? 'var(--red)' : undefined} />)}
    </Section>}
    {(r.bodyweight || r.measures.length > 0) && <Section title={t('Body')}>
      {r.bodyweight && <Line label={t('Body weight')} value={`${fmtNum(r.bodyweight.from)} → ${fmtNum(r.bodyweight.to)} ${u} · ${signed(r.bodyweight.delta)}`} />}
      {r.measures.map(m => <Line key={m.key} label={t(MEASURE_NAME[m.key])} value={`${fmtNum(m.from)} → ${fmtNum(m.to)} ${lu} · ${signed(m.delta)}`} />)}
    </Section>}
  </>
}
export const mesoReportSheet = () => useUI.getState().openSheet(() => <MesoReportSheet />)

/** Stats card: the latest mesocycle in one line, and the way into the full report. */
export default function MesoReportCard({ S }) {
  const r = useMemo(() => latestMesoReport(S), [S])
  if (!r) return null
  const best = r.strength[0]
  return <div className="card" data-testid="meso-report-card">
    <div className="row between" style={{ marginBottom: 6 }}>
      <h2 style={{ margin: 0 }}>{t(r.running ? 'Mesocycle in progress' : 'Last mesocycle')}</h2>
      <Button size="sm" icon="clipboard" onClick={mesoReportSheet}>{t('Report')}</Button>
    </div>
    <div className="small muted">{span(r)} · {t('{0} loading microcycles', r.micros)} · {r.sessions}/{r.planned} {t('sessions')}</div>
    {best && <div className="small" style={{ marginTop: 6 }}>
      <Icon name="chartLine" style={{ color: best.pct >= 0 ? 'var(--green)' : 'var(--red)' }} /> <span className="capitalize">{nameOf(best.id)}</span> · {signed(best.pct)} % {t('est. 1RM')}
    </div>}
  </div>
}
