import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { EXDB, BODYPARTS, allExercises, equipmentOf, matchExercise } from '../lib/exercises.js'
import { activeProfile, exAvailable, ADJUSTABLE, adjustableFor } from '../lib/equipment.js'
import { topOf } from '../lib/load-scale.js'
import { muscleLabel, MUSCLE_NAME } from '../lib/muscles.js'
import { trainsMuscle, muscleGroupCounts } from '../lib/muscle-groups.js'
import { glyphOfMuscle } from '../lib/glyphs.js'
import { bestWeightFor, workSetCounts } from '../lib/history.js'
import { favoriteMap, favoritesFirst } from '../lib/favorites.js'
import { fmtNum } from '../lib/format.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { Thumb } from '../components/Media.jsx'
import { exerciseDetailSheet, addToRoutineSheet, customExSheet, importExercisesSheet, FavoriteStar } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { tappable, useRevealActiveChip } from '../lib/use-sheet-keyboard.js'

export default function Library() {
  const S = useStore(s => s.S)
  const [q, setQ] = useState('')
  const [scope, setScope] = useState('')   // '' = all, 'fav' / 'nofav' = favourite or not, 'trained' = in history
  const [bp, setBp] = useState('')
  const [mu, setMu] = useState('')   // muscle group slug from the grid ('' = none picked)
  const [eq, setEq] = useState('')
  const [adjOn, setAdjOn] = useState(false)   // the dumbbell chip, tapped again: adjustable dumbbells
  const [showAll, setShowAll] = useState(false)   // ignore the active equipment profile for this session
  const [shown, setShown] = useState(40)
  const bpStrip = useRef(null), eqStrip = useRef(null)
  const profile = activeProfile(S)
  const favs = favoriteMap(S)
  const favCount = Object.keys(favs).length
  const trainedCounts = workSetCounts(S)
  const trainedCount = Object.keys(trainedCounts).length
  // Scope, body part and equipment filter independently of each other.
  const inScope = e => scope === 'fav' ? !!favs[e.id] : scope === 'nofav' ? !favs[e.id] : scope === 'trained' ? !!trainedCounts[e.id] : true
  const base = favoritesFirst(S, allExercises(S).filter(e => inScope(e) && (!bp || e.bp === bp) && matchExercise(e, q)))
  const profiled = (profile && !showAll) ? base.filter(e => exAvailable(S, e)) : base
  // Browsing by muscle group: the grid of group cards shows until the user searches, filters or picks one.
  const browsing = !mu && !bp && !scope && !q.trim()
  const eqFiltered = mu ? profiled.filter(e => trainsMuscle(e, mu)) : profiled
  const eqOpts = equipmentOf(eqFiltered)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  const f = eqOn ? eqFiltered.filter(e => e.eq === eqOn) : eqFiltered
  // Adjustable dumbbells list the dumbbell exercises; "+ Plan" sets them up for your set's range.
  const adjustable = eqOn === 'dumbbell' && adjOn
  const adj = adjustable ? adjustableFor(S) : null
  const pickEq = x => {
    if (x === 'dumbbell' && eqOn === 'dumbbell') setAdjOn(v => !v)
    else { setEq(x); setAdjOn(false) }
    setShown(40)
  }
  const pickScope = v => { setScope(s => s === v ? '' : v); setShown(40) }
  const pickMu = slug => { setMu(m => m === slug ? '' : slug); setEq(''); setAdjOn(false); setShown(40) }
  const muCounts = browsing ? muscleGroupCounts(profiled) : null
  const ico = { fontSize: 12, display: 'inline-block', marginRight: 4, verticalAlign: '-1px' }
  useRevealActiveChip(bpStrip, bp)
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
    {(favCount > 0 || trainedCount > 0 || scope) && <div className="chips" style={{ marginBottom: 8 }}>
      {/* one chip for favourites that cycles: favourites → not favourites → all */}
      <button className={'chip nocap' + (scope === 'fav' || scope === 'nofav' ? ' on' : '')} aria-pressed={scope === 'fav' || scope === 'nofav'}
        onClick={() => { setScope(s => s === 'fav' ? 'nofav' : s === 'nofav' ? '' : 'fav'); setShown(40) }}>
        <Icon name={scope === 'fav' ? 'starFill' : 'star'} style={ico} />
        {scope === 'fav' ? `${t('Favourites')} (${favCount})` : scope === 'nofav' ? t('Not favourites') : t('All exercises')}
      </button>
      {trainedCount > 0 && <button className={'chip' + (scope === 'trained' ? ' on' : '')} aria-pressed={scope === 'trained'} onClick={() => pickScope('trained')}><Icon name="clock" style={ico} />{t('Trained')} ({trainedCount})</button>}
    </div>}
    <div className="chips" ref={bpStrip} style={{ marginBottom: eqOpts.length > 1 ? 8 : 12 }}>
      <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setShown(40) }}>{t('All')}</button>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setShown(40) }}>{t(b)}</button>)}
    </div>
    {eqOpts.length > 1 && <div className="chips" ref={eqStrip} style={{ marginBottom: 12 }}>
      <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => pickEq('')}>{t('Any equipment')}</button>
      {/* Tapped again once on, the dumbbell chip switches between dumbbells and adjustable ones. */}
      {eqOpts.map(x => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => pickEq(x)}>
        {x === 'dumbbell' && adjustable ? t(ADJUSTABLE) : t(x)}
      </button>)}
    </div>}
    {adjustable && <div className="small dim row" style={{ margin: '-4px 2px 12px', gap: 6, alignItems: 'center' }}>
      <Icon name="dumbbell" style={{ fontSize: 13 }} />
      {t('{0}–{1} {3}, +{2} {3} — added to a routine with these weights.', fmtNum(adj.from), fmtNum(topOf(adj)), fmtNum(adj.step), S.unit)}
    </div>}
    {browsing && <>
      <div className="small dim" style={{ margin: '0 2px 8px' }}>{t('Pick a muscle group to see its exercises.')}</div>
      <div className="tiles" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {muCounts.map(({ slug, count }) => <button key={slug} className="card nocap" disabled={!count} onClick={() => pickMu(slug)}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '10px 8px', margin: 0, opacity: count ? 1 : 0.45, cursor: count ? 'pointer' : 'default', border: 0, font: 'inherit', color: 'inherit' }}>
          {glyphOfMuscle(slug) && <Icon name={glyphOfMuscle(slug)} size={56} style={{ marginBottom: 6 }} />}
          <div className="tt capitalize" style={{ fontSize: 14 }}>{t(MUSCLE_NAME[slug])}</div>
          <div className="small dim">{count} {t('exercises')}</div>
        </button>)}
      </div>
    </>}
    {mu && <div className="row" style={{ alignItems: 'center', gap: 8, margin: '0 2px 10px' }}>
      <button className="chip nocap" onClick={() => pickMu('')}>← {t('Muscle groups')}</button>
      <div className="tt capitalize" style={{ marginLeft: 'auto' }}>{t(MUSCLE_NAME[mu])}</div>
    </div>}
    {!browsing && <div className="list">
      <div className="item" {...tappable(() => customExSheet(null, ex => exerciseDetailSheet(ex), q.trim()))}>
        <div className="thumb thumb-x"><Icon name="sparkles" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name, muscles, equipment, instructions and image')}</div></div><Icon name="plus" className="chev" />
      </div>
      <div className="item" {...tappable(() => importExercisesSheet())}>
        <div className="thumb thumb-x"><Icon name="download" /></div>
        <div className="grow"><div className="tt">{t('Import exercises')}</div><div className="ss">{t('from open exercise sources, with their picture and credit')}</div></div><Icon name="plus" className="chev" />
      </div>
      {f.slice(0, shown).map(e => {
        const best = bestWeightFor(S, e.id)
        return <div key={e.id} className="item" {...tappable(() => exerciseDetailSheet(e))}>
          <Thumb ex={e} muscle />
          <div className="grow"><div className="tt capitalize">{exerciseNameFor(e)}</div><div className="ss capitalize">{t(muscleLabel(e.tg || e.bp))} · {t(e.eq)}</div></div>
          <FavoriteStar st={S} id={e.id} />
          {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
          <Button size="sm" variant="tinted" icon="plus" onClick={ev => { ev.stopPropagation(); addToRoutineSheet(e, adj && e.eq === 'dumbbell' ? { adj } : undefined) }}>{t('Plan')}</Button>
        </div>
      })}
      {f.length === 0 && <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No match')}</div>}
    </div>}
    {!browsing && f.length > shown && <><div style={{ height: 10 }} /><Button onClick={() => setShown(s => s + 40)}>{t('Show more')}</Button></>}
  </>
}

