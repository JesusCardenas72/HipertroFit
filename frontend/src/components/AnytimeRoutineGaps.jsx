import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { anytimeRoutineGaps, volumeColor, volumeStatus, volumeVerdict, groupExecution, VOLUME_GROUPS, targetOf } from '../lib/volume.js'
import { glyphOfMuscle } from '../lib/glyphs.js'
import Icon from './Icon.jsx'
import ZoneBar from './ZoneBar.jsx'
import { VERDICT } from './volume-verdict.js'

// On the programming screen of a routine outside the sequence — one to train any time — where each
// group lands in the running microcycle with this routine done on top of the plan (lib/volume.js
// anytimeRoutineGaps), drawn like every other volume panel (VolumeGroupBars): the name with the
// share of its volume already executed beside it, the line that says what it still lacks for its
// minimum (or will have past its maximum), the figures at its right — the gap Home shows, struck
// through when this routine changes it, and the sets programmed here — and the zoned bar (ZoneBar):
// the sets done, the sets still planned (striped) and this routine's (blue). Every set added here
// comes off the gap as it is programmed. The groups it trains come first; the counts are per group
// and not to be added up.
const groupGlyph = g => {
  for (const m of g.muscles || []) { const k = glyphOfMuscle(m); if (k) return k }
  return null
}

export default function AnytimeRoutineGaps({ S, routine }) {
  const rows = anytimeRoutineGaps(S, routine)
    .sort((a, b) => (b.adds > 0) - (a.adds > 0))
  if (!rows.length) return null
  return <div className="card anytime-gaps" style={{ marginTop: 12 }} data-testid="anytime-gaps">
    <h2>{t('Sets missing this microcycle')}</h2>
    <div className="muted small" style={{ marginBottom: 6 }}>
      {t('This routine is outside the sequence: what each group still lacks for its minimum once it is done on top of the plan.')}
    </div>
    <div className="vol-bars">
      {rows.map(g => {
        const band = targetOf(VOLUME_GROUPS.find(x => x.key === g.key) || g)
        const planned = g.done + g.ahead
        // The plan here is the microcycle's and this routine together, so "short even with the
        // plan" reads simply as short.
        const verdict = volumeVerdict(g, { done: g.done, left: g.ahead + g.adds, max: band.max })
        const [say, sayColor] = VERDICT[verdict.kind === 'shortWithPlan' ? 'short' : verdict.kind]
        // Of the plan while the block still plans sets for the group, else of its minimum.
        const ex = groupExecution({ done: g.done, planned: g.ahead > 0 ? planned : 0, min: band.min, max: band.max })
        const changed = g.before !== g.remaining
        return <div key={g.key} className={'vol-bar-row' + (g.adds > 0 ? '' : ' dim')} data-group={g.key}>
          <div className="vol-name">
            <span className="nm">{t(g.name)}</span>
            {ex.pct != null && <span className="vol-pct">{ex.pct}%</span>}
            {groupGlyph(g) && <Icon name={groupGlyph(g)} className="vol-glyph" />}
          </div>
          <span className="v">
            <span className="say" style={{ color: sayColor }}>{say(verdict.n)}</span>
            <span className="fig">
              {changed && g.before > 0 && <><s className="dim">{'+' + g.before}</s>{' '}</>}
              {g.adds > 0 && <span className="added">{t('{0} here', fmtNum(g.adds))}</span>}
              {g.adds > 0 && <span className="sep">{' · '}</span>}
              <span className="rng">{band.min}–{band.max}</span>
            </span>
          </span>
          <ZoneBar done={g.done} planned={planned} after={planned + g.adds} band={band}
            color={volumeColor(volumeStatus(g.done, band))} />
        </div>
      })}
    </div>
  </div>
}
