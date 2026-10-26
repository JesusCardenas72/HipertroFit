import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { EXDB, BODYPARTS, allExercises, equipmentOf, matchExercise } from '../lib/exercises.js'
import { activeProfile, exAvailable } from '../lib/equipment.js'
import { muscleLabel } from '../lib/muscles.js'
import { bestWeightFor, workSetCounts } from '../lib/history.js'
import { isFavorite, favoritesFirst } from '../lib/favorites.js'
import { fmtNum } from '../lib/format.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { Thumb } from '../components/Media.jsx'
import { exerciseDetailSheet, addToRoutineSheet, customExSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { tappable, useRevealActiveChip } from '../lib/use-sheet-keyboard.js'

export default function Library() {
  const S = useStore(s => s.S)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const [eq, setEq] = useState('')
  const [showAll, setShowAll] = useState(false)   // ignore the active equipment profile for this session
  const [shown, setShown] = useState(40)
  const bpStrip = useRef(null), eqStrip = useRef(null)
  const profile = activeProfile(S)
  const favCount = (S.favEx || []).length
  const trainedCounts = workSetCounts(S)
  const trainedCount = Object.keys(trainedCounts).length
  // '♥' is the favourites filter; '★' is the trained-in-history filter.
  // Both fall back to everything when their set is empty.
  const bpOn = (bp === '♥' && !favCount) || (bp === '★' && !trainedCount) ? '' : bp
  const base = favoritesFirst(S, allExercises(S).filter(e =>
    (bpOn === '♥' ? isFavorite(S, e.id) : bpOn === '★' ? !!trainedCounts[e.id] : (!bpOn || e.bp === bpOn)) && matchExercise(e, q)))
  const eqFiltered = (profile && !showAll) ? base.filter(e => exAvailable(S, e)) : base
  const eqOpts = equipmentOf(eqFiltered)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  const f = eqOn ? eqFiltered.filter(e => e.eq === eqOn) : eqFiltered
  useRevealActiveChip(bpStrip, bpOn)
  useRevealActiveChip(eqStrip, eqOn)

  return <>
    <div className="hdr"><div><h1>{t('Exercises')}</h1><div className="sub">{t('{0} exercises with animations', EXDB.length)}</div></div></div>
    <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search…')} value={q} onChange={e => { setQ(e.target.value); setShown(40) }} /></div>
    {profile && <div className="small dim row" style={{ margin: '-4px 2px 10px', gap: 6, alignItems: 'center' }}>
      <Icon name="dumbbell" style={{ fontSize: 13 }} />
      {showAll ? t('Showing all equipment') : t('Showing what you have in "{0}"', profile.name)}
      <button className="chip nocap" style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 12 }} onClick={() => setShowAll(v => !v)}>
        {showAll ? t('Filter by "{0}"', profile.name) : t('Show all equipment')}
      </button>
    </div>}
    <div className="chips" ref={bpStrip} style={{ marginBottom: eqOpts.length > 1 ? 8 : 12 }}>
      {trainedCount > 0 && <button className={'chip' + (bpOn === '★' ? ' on' : '')} onClick={() => { setBp('★'); setEq(''); setShown(40) }}><Icon name="clock" style={{ fontSize: 12, display: 'inline-block', marginRight: 4, verticalAlign: '-1px' }} />{t('Trained')} ({trainedCount})</button>}
      {favCount > 0 && <button className={'chip' + (bpOn === '♥' ? ' on' : '')} onClick={() => { setBp('♥'); setEq(''); setShown(40) }}><Icon name="heartFill" style={{ fontSize: 12, display: 'inline-block', marginRight: 4, verticalAlign: '-1px' }} />{t('Favourites')} ({favCount})</button>}
      <button className={'chip nocap' + (!bpOn ? ' on' : '')} onClick={() => { setBp(''); setEq(''); setShown(40) }}>{t('All')}</button>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bpOn === b ? ' on' : '')} onClick={() => { setBp(b); setEq(''); setShown(40) }}>{t(b)}</button>)}
    </div>
    {eqOpts.length > 1 && <div className="chips" ref={eqStrip} style={{ marginBottom: 12 }}>
      <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(40) }}>{t('Any equipment')}</button>
      {eqOpts.map(x => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(40) }}>{t(x)}</button>)}
    </div>}
    <div className="list">
      <div className="item" {...tappable(() => customExSheet(null, ex => exerciseDetailSheet(ex), q.trim()))}>
        <div className="thumb thumb-x"><Icon name="sparkles" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name, muscles, equipment, instructions and image')}</div></div><Icon name="plus" className="chev" />
      </div>
      {f.slice(0, shown).map(e => {
        const best = bestWeightFor(S, e.id)
        return <div key={e.id} className="item" {...tappable(() => exerciseDetailSheet(e))}>
          <Thumb ex={e} />
          <div className="grow"><div className="tt capitalize">{exerciseNameFor(e)}</div><div className="ss capitalize">{t(muscleLabel(e.tg || e.bp))} · {t(e.eq)}</div></div>
          {isFavorite(S, e.id) && <span className="tag" style={{ color: 'var(--red)' }} title={t('Favourite')}><Icon name="heartFill" /></span>}
          {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
          <Button size="sm" variant="tinted" icon="plus" onClick={ev => { ev.stopPropagation(); addToRoutineSheet(e) }}>{t('Plan')}</Button>
        </div>
      })}
      {f.length === 0 && <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No match')}</div>}
    </div>
    {f.length > shown && <><div style={{ height: 10 }} /><Button onClick={() => setShown(s => s + 40)}>{t('Show more')}</Button></>}
  </>
}

