import { useMemo } from 'react'
import Icon from './Icon.jsx'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { EXIDX } from '../lib/exercises.js'
import { stalledExercises } from '../lib/stagnation.js'
import { tappable } from '../lib/use-sheet-keyboard.js'

// The exercises that stopped improving (lib/stagnation.js), with what usually gets them moving
// again. Tapping one shows its curve in the exercise progress card below (`onPick`).
const MAX_SHOWN = 5

export default function StalledCard({ S, onPick }) {
  const stalled = useMemo(() => stalledExercises(S), [S])
  if (!stalled.length) return null
  const nameOf = id => (EXIDX[id] ? exerciseNameFor(EXIDX[id]) : id)
  return <div className="card" data-testid="stalled-card">
    <h2 className="row" style={{ gap: 8 }}><span style={{ color: 'var(--orange)', display: 'inline-flex' }}><Icon name="warning" /></span>{t('Stalled exercises')}</h2>
    <div className="list" style={{ display: 'flex', flexDirection: 'column', marginBottom: 8 }}>
      {stalled.slice(0, MAX_SHOWN).map(x => <div key={x.id} className="item" {...tappable(() => onPick && onPick(x))}>
        <div className="grow">
          <div className="tt capitalize">{nameOf(x.id)}</div>
          <div className="ss">
            {t('{0} microcycles without beating {1}', x.micros, fmtNum(x.best) + ' ' + (x.metric === 'e1rm' ? S.unit + ' ' + t('est. 1RM') : x.metric === 'reps' ? t('reps') : t('weight × reps')))}
          </div>
        </div>
        <Icon name="chevronRight" style={{ color: 'var(--label-3)', flex: 'none' }} />
      </div>)}
    </div>
    <div className="small dim" style={{ lineHeight: 1.45 }}>
      {t('Try a variation of the exercise, another rep range, or fewer sets around it. A deload also often breaks a stall.')}
    </div>
  </div>
}
