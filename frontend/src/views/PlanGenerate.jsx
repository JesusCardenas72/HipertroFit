import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { CATALOGUE, EXIDX, matchExercise } from '../lib/exercises.js'
import { classifyExercise, CLASS_NAME, CLASS_REP_RANGE } from '../lib/exercise-class.js'
import { patternName, patternOf } from '../lib/movement-patterns.js'
import { isFavorite, toggleFavorite } from '../lib/favorites.js'
import { ownsEquipment, newProfile } from '../lib/equipment.js'
import { programActive } from '../lib/program.js'
import { modeOf } from '../lib/history.js'
import { DAYS } from '../lib/format.js'
import { VOLUME_GROUPS, targetOf } from '../lib/volume.js'
import { SPLITS, SPLIT_KEYS, hasVariants } from '../lib/split-templates.js'
import { LEVELS, LEVEL_KEYS, applyDraft, buildDraft, candidatesFor, draftVolume } from '../lib/plan-generator.js'
import Icon from '../components/Icon.jsx'
import './PlanGenerate.css'

/* Plan ▸ Generate plan: a full screen in the look of the movement-pattern planner the user
   designed it from. Choose a split and a level, mark your equipment, then go through the week
   slot by slot: every slot arrives filled, and "Change" lists every exercise of its pattern —
   favourites, then what your equipment allows, then the rest. The volume bars follow every
   change. Nothing becomes routines until "Create plan"; until then the choices are kept in
   S.planGen, so the screen can be left and picked up again later. Engine: lib/plan-generator.js. */

const SPLIT_SHORT = { 'full-body': 'Full body', 'upper-lower': 'Upper / Lower', ppl: 'PPL' }
const SPLIT_HINT = {
  'full-body': '3 days a week (Monday, Wednesday, Friday). Every day trains the whole body.',
  'upper-lower': '4 days a week (Monday, Tuesday, Thursday, Friday). Each muscle twice.',
  ppl: '6 days a week (Monday to Saturday). Each muscle twice.',
}
const LEVEL_HINT = {
  beginner: '6 exercises per session, few sets and RIR 2–3. No variants: the A days repeat, fewer exercises to learn.',
  intermediate: '6 exercises per session and RIR 1–2. A and B days with different exercises.',
  advanced: 'Up to 7 exercises and 4 sets on the main lift. RIR 0 only on isolation work and the last set.',
}
const ROLE = { main: 'Main', secondary: 'Secondary', accessory: 'Accessory' }
const WEEK = [1, 2, 3, 4, 5, 6, 0]   // the layout runs Monday first
const PRESETS = {
  gym: ['barbell', 'dumbbell', 'cable', 'leverage machine', 'smith machine', 'sled machine', 'ez barbell', 'band', 'kettlebell',
    'weighted', 'assisted', 'olympic barbell', 'trap bar', 'rope', 'stability ball', 'medicine ball', 'wheel roller', 'resistance band'],
  home: ['dumbbell', 'band', 'resistance band', 'kettlebell', 'stability ball'],
}
// How many exercises with a slot pattern each piece of equipment opens, most first. Body weight
// is always available, so it has no chip.
const EQUIP_COUNTS = (() => {
  const c = {}
  for (const ex of CATALOGUE) if (patternOf(ex) && ex.eq && ex.eq !== 'body weight') c[ex.eq] = (c[ex.eq] || 0) + 1
  return Object.entries(c).sort((a, b) => b[1] - a[1])
})()
const STRATEGY_SPLIT = { 'full-body': 'full-body', 'upper-lower': 'upper-lower', ppl: 'ppl' }

/** What the screen keeps between visits: the choices, never the routines themselves. */
export function planGenOf(S) {
  const g = S.planGen || {}
  return {
    split: SPLITS[g.split] ? g.split : (STRATEGY_SPLIT[S.program?.strategy] || 'ppl'),
    level: LEVELS[g.level] ? g.level : 'intermediate',
    variants: typeof g.variants === 'boolean' ? g.variants : null,
    profileId: typeof g.profileId === 'string' ? g.profileId : (S.activeEquipId || ''),
    picks: g.picks && typeof g.picks === 'object' ? g.picks : {},
    sets: g.sets && typeof g.sets === 'object' ? g.sets : {},
    seq: Array.isArray(g.seq) ? g.seq : null,
  }
}

const statusOf = (v, b) => (v < b.min ? 'low' : v > b.max ? 'high' : 'ok')
const fmt = n => String(Math.round(n * 10) / 10).replace('.', ',')
const clsKey = ex => classifyExercise(ex)
const rangeOf = ex => {
  if (modeOf({ id: ex.id }) === 'time') return t('30–60 s')
  const r = CLASS_REP_RANGE[clsKey(ex)]
  return t('{0}–{1} reps', r.repsMin, r.reps)
}

export default function PlanGenerate() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const g = planGenOf(S)
  const [day, setDay] = useState(null)
  const [ordering, setOrdering] = useState(false)
  const [armed, setArmed] = useState(false)
  const profiles = S.equipProfiles || []
  const profile = profiles.find(p => p.id === g.profileId) || null
  const v = g.variants ?? LEVELS[g.level].variants
  const draft = useMemo(() => buildDraft(S, { split: g.split, level: g.level, variants: v, profile, picks: g.picks, sets: g.sets, seq: g.seq }),
    [S, g.split, g.level, v, profile, g.picks, g.sets, g.seq])
  const vol = useMemo(() => draftVolume(S, draft), [S, draft])
  const cur = draft.days.find(d => d.key === day) || draft.days[0]
  const save = patch => update(s => { s.planGen = { ...planGenOf(s), ...patch } })
  const changed = Object.keys(g.picks).length + Object.keys(g.sets).length > 0

  const writeEquip = fn => update(s => {
    s.equipProfiles = s.equipProfiles || []
    let p = s.equipProfiles.find(x => x.id === g.profileId)
    if (!p) {
      // The first tick with no profile picked makes one, and the screen uses it from then on.
      p = newProfile(t('My equipment'))
      s.equipProfiles.push(p)
      if (!s.activeEquipId) s.activeEquipId = p.id
      s.planGen = { ...planGenOf(s), profileId: p.id }
    }
    p.equipment = fn(p.equipment || [])
  })
  const has = new Set(profile?.equipment || [])

  const openSlot = sl => openPicker({ slot: sl, profile, dayName: t(cur.name),
    onPick: id => save({ picks: (() => { const n = { ...g.picks }; if (id) n[sl.key] = id; else delete n[sl.key]; return n })() }) })
  const setSlotSets = (sl, n) => save({ sets: { ...g.sets, [sl.key]: Math.max(0, Math.min(8, n)) } })
  const unpin = sl => { const n = { ...g.sets }; delete n[sl.key]; save({ sets: n }) }
  const reset = () => {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return }
    setArmed(false); save({ picks: {}, sets: {} })
  }
  const moveDay = (i, dir) => {
    const s2 = [...draft.seq], j = i + dir
    if (j < 0 || j >= s2.length) return
    ;[s2[i], s2[j]] = [s2[j], s2[i]]
    save({ seq: s2 })
  }
  const create = () => {
    const name = t(SPLITS[g.split].name) + ' · ' + t(LEVELS[g.level].name)
    update(s => { applyDraft(s, draft, { name, label: t }) })
    useUI.getState().toast(t('Plan created — {0} sessions per microcycle', draft.seq.filter(k => k !== 'rest').length))
    nav('/plan')
  }

  const groups = VOLUME_GROUPS.filter(x => !x.direct)
  const max = Math.max(24, ...groups.map(x => vol.groups[x.key] || 0))
  const counts = groups.map(x => statusOf(vol.groups[x.key] || 0, targetOf(x)))
  const low = counts.filter(x => x === 'low').length, high = counts.filter(x => x === 'high').length
  const dayName = k => t((draft.days.find(d => d.key === k) || {}).name || '')

  return <div className="pg pg-page"><div className="pg-wrap">
    <header>
      <div className="pg-top">
        <button className="pg-back" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
        <div className="pg-label">{t('HipertroFit · programming')}</div>
      </div>
      <h1>{t('Plan by movement patterns')}</h1>
      <p className="pg-lead">{t('Each session is a list of pattern slots (horizontal push, hinge…). For each slot you see every exercise of that pattern: your favourites first, then the ones your equipment allows, then the rest. Your choices are kept here and you can change them whenever you like.')}</p>
    </header>

    <div className="pg-board">
      <aside className="pg-stack">
        <section className="pg-panel" aria-labelledby="pg-h-split">
          <h2 id="pg-h-split">{t('Your plan')}</h2>
          <div>
            <div className="pg-label" style={{ marginBottom: 6 }}>{t('Split')}</div>
            <div className="pg-seg" role="group" aria-label={t('Split')}>
              {SPLIT_KEYS.map(k => <button key={k} aria-pressed={g.split === k} onClick={() => { setDay(null); save({ split: k, seq: null }) }}>{t(SPLIT_SHORT[k])}</button>)}
            </div>
            <p className="pg-hint" style={{ marginTop: 6 }}>{t(SPLIT_HINT[g.split])}</p>
          </div>
          <div>
            <div className="pg-label" style={{ marginBottom: 6 }}>{t('Level')}</div>
            <div className="pg-seg" role="group" aria-label={t('Level')}>
              {LEVEL_KEYS.map(k => <button key={k} aria-pressed={g.level === k} onClick={() => save({ level: k, variants: null, seq: null })}>{t(LEVELS[k].name)}</button>)}
            </div>
            <p className="pg-hint" style={{ marginTop: 6 }}>{t(LEVEL_HINT[g.level])}</p>
          </div>
          {g.split !== 'full-body' && <label className="pg-switch">
            <input id="pg-variants" type="checkbox" checked={hasVariants(g.split, v)} onChange={e => save({ variants: e.target.checked, seq: null })} />
            {t('Different A and B days (variants)')}
          </label>}
        </section>

        <section className="pg-panel" aria-labelledby="pg-h-equip">
          <div className="pg-row pg-between"><h2 id="pg-h-equip">{t('Your equipment')}</h2>
            <div className="pg-row" style={{ gap: 12 }}>
              <button className="pg-link" onClick={() => writeEquip(() => [...PRESETS.gym])}>{t('Full gym')}</button>
              <button className="pg-link" onClick={() => writeEquip(() => [...PRESETS.home])}>{t('At home')}</button>
            </div>
          </div>
          {profiles.length > 0 && <div className="pg-chips">
            <button className="pg-chip" aria-pressed={!profile} onClick={() => save({ profileId: '' })}>{t('Everything')}</button>
            {profiles.map(p => <button key={p.id} className="pg-chip" style={{ textTransform: 'none' }} aria-pressed={p.id === g.profileId} onClick={() => save({ profileId: p.id })}>{p.name}</button>)}
          </div>}
          <p className="pg-hint">{profile
            ? t('What you tick decides the “With your equipment” group. Body weight always counts.')
            : t('Everything counts as available. Tick what you have to sort the lists by it.')}</p>
          <div className="pg-chips">
            {EQUIP_COUNTS.map(([k, n]) => <button key={k} className="pg-chip" aria-pressed={has.has(k)}
              onClick={() => writeEquip(list => (list.includes(k) ? list.filter(x => x !== k) : [...list, k]))}>
              {t(k)}<span className="n">{n}</span></button>)}
          </div>
        </section>

        <section className="pg-panel" aria-labelledby="pg-h-vol">
          <div className="pg-row pg-between"><h2 id="pg-h-vol">{t('Weekly volume')}</h2>
            <span className="pg-hint">{!low && !high ? t('All in range') : [low && t('{0} under', low), high && t('{0} over', high)].filter(Boolean).join(' · ')}</span></div>
          <p className="pg-hint">{t('Sets per microcycle and muscle group with what you chose, counted as on the volume panel. The sets spread themselves so each group lands in its range; the ones you change with − / + stay fixed.')}</p>
          <div className="pg-vol">
            {groups.map(x => {
              const val = vol.groups[x.key] || 0, b = targetOf(x), st = statusOf(val, b)
              return <div key={x.key} className="pg-vrow" title={t('{0}: range {1}–{2} sets', t(x.short || x.name), b.min, b.max)}>
                <span className="nm">{t(x.short || x.name)}</span>
                <span className="pg-vbar"><span className="pg-vband" style={{ left: b.min / max * 100 + '%', width: (b.max - b.min) / max * 100 + '%' }} />
                  <span className={'pg-vfill bg-' + st} style={{ width: Math.min(100, val / max * 100) + '%' }} /></span>
                <span className={'pg-vnum ' + st}>{fmt(val)}</span>
              </div>
            })}
          </div>
          <div className="pg-legend"><span><i className="bg-low" />{t('under')}</span><span><i className="bg-ok" />{t('in range')}</span><span><i className="bg-high" />{t('over')}</span></div>
        </section>
      </aside>

      <main className="pg-stack">
        <section className="pg-panel" aria-labelledby="pg-h-week">
          <div className="pg-row pg-between"><h2 id="pg-h-week">{t('Week')}</h2>
            <span className="pg-hint">{t('RIR {0} · double progression', LEVELS[g.level].rir)}</span></div>
          <div className="pg-week">
            {draft.seq.slice(0, 7).map((k, i) => <button key={i} className={'pg-wd' + (k === cur.key ? ' on' : '')}
              onClick={() => k !== 'rest' && setDay(k)} disabled={k === 'rest'}>
              <b>{t(DAYS[WEEK[i]])}</b><span>{k === 'rest' ? t('Rest') : dayName(k)}</span></button>)}
          </div>
          <div className="pg-row pg-between">
            <div className="pg-tabs" role="tablist" aria-label={t('Sessions')}>
              {draft.days.map(d => <button key={d.key} className="pg-tab" role="tab" aria-selected={d.key === cur.key} onClick={() => setDay(d.key)}>{t(d.name)}</button>)}
            </div>
            <button className="pg-link" onClick={() => setOrdering(o => !o)}>{ordering ? t('Done') : t('Change the order of the days')}</button>
          </div>
          {ordering && <div className="pg-order">
            {draft.seq.map((k, i) => <div key={i} className="pg-order-row">
              <b className="pg-label" style={{ width: 34 }}>{t(DAYS[WEEK[i % 7]])}</b>
              <span className="grow">{k === 'rest' ? t('Rest day') : dayName(k)}</span>
              <button className="pg-mini" onClick={() => moveDay(i, -1)} disabled={i === 0} aria-label={t('Move up')}><Icon name="chevronUp" /></button>
              <button className="pg-mini" onClick={() => moveDay(i, 1)} disabled={i === draft.seq.length - 1} aria-label={t('Move down')}><Icon name="chevronDown" /></button>
            </div>)}
            <p className="pg-hint">{t('Rest days only place the sessions on the calendar: train on a rest day and you simply do the next session.')}</p>
          </div>}
          <ol className="pg-slots">
            {cur.slots.map((sl, i) => {
              const e = sl.id ? EXIDX[sl.id] : null
              const elsewhere = e ? draft.days.filter(d => d.key !== cur.key && d.slots.some(x => x.id === e.id)).map(d => t(d.name)) : []
              return <li key={sl.key} className={'pg-slot' + (sl.sets ? '' : ' off')}>
                <div className="pg-num">{i + 1}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="pg-pat"><span className="p">{t(patternName(sl.pattern))}</span><span className={'pg-role' + (sl.role === 'main' ? ' main' : '')}>{t(ROLE[sl.role])}</span></div>
                  <div className="pg-exn">{e ? exerciseNameFor(e) : t('Pick an exercise')}</div>
                  {e && <div className="pg-meta">
                    <span className={'pg-tag' + (sl.picked ? ' pick' : '')}>{sl.picked ? t('Chosen by you') : t('suggested')}</span>
                    {isFavorite(S, e.id) && <span className="pg-tag fav">♥ {t('Favourite')}</span>}
                    <span className="pg-tag">{t(e.eq)}</span>
                    <span className="pg-tag">{t(CLASS_NAME[clsKey(e)])}</span>
                    {ownsEquipment(profile, e) === false && <span className="pg-tag warn">{t('not in your equipment')}</span>}
                    {elsewhere.length > 0 && <span className="pg-tag">{t('also on {0}', elsewhere.join(', '))}</span>}
                  </div>}
                </div>
                <div className="pg-ctl">
                  <span className="pg-step" aria-label={t('Sets')}>
                    <button onClick={() => setSlotSets(sl, sl.sets - 1)} aria-label={t('Remove a set')}>−</button>
                    <output>{sl.sets}</output>
                    <button onClick={() => setSlotSets(sl, sl.sets + 1)} aria-label={t('Add a set')}>+</button>
                  </span>
                  <span className="pg-rx">{sl.sets ? (e ? sl.sets + ' × ' + rangeOf(e) : '') : t('Left out')}
                    {sl.pinned && <> · <button className="pg-link" onClick={() => unpin(sl)} title={t('Let the plan spread these sets')}>{t('fixed · auto')}</button></>}</span>
                  <button className="pg-btn small" onClick={() => openSlot(sl)}>{t('Change')}</button>
                </div>
              </li>
            })}
          </ol>
          {changed && <div className="pg-row pg-between">
            <span className="pg-hint">{t('Your changes are kept until you create the plan.')}</span>
            <button className="pg-link" onClick={reset}>{armed ? t('Tap again to go back to the suggestions') : t('Back to the suggestions')}</button>
          </div>}
        </section>

        <section className="pg-panel" aria-labelledby="pg-h-create">
          <h2 id="pg-h-create">{t('Create the plan')}</h2>
          <ol className="pg-list">
            <li>{t('The routines go into a new folder. Each exercise uses double progression in the range of its type.')}</li>
            <li>{t('The day sequence becomes your programming, and a new microcycle starts.')}</li>
            <li>{t('Afterwards you can change any exercise, set or weight from each routine.')}</li>
          </ol>
          {programActive(S.program) && <p className="pg-warn">{t('This replaces your current day sequence; your other routines stay as they are.')}</p>}
          <button className="pg-btn big" onClick={create}>{t('Create plan')}</button>
        </section>
      </main>
    </div>

    <Science />
  </div></div>
}

/* ---------- why it is built this way ---------- */

const CARDS = [
  { title: 'Patterns as the backbone', body: 'Coaching lists agree on a core: squat, hinge, lunge, push and pull (horizontal and vertical), sometimes carry and rotation.',
    apply: 'Here: every session covers those patterns with fixed slots and adds isolation work for what the compounds load poorly (side delts, biceps, hamstrings, calves).',
    links: [['World Rugby · Movement patterns', 'https://passport.world.rugby/conditioning-for-rugby/advanced-conditioning-for-rugby-pre-level-2/resistance-training/the-gym-based-training-programme/movement-patterns/'],
      ['NIFS · Optimal movement patterns for building muscle', 'https://www.nifs.org/blog/optimal-movement-patterns-for-building-muscle']] },
  { title: 'Weekly volume', body: 'More weekly sets bring more growth, with diminishing returns. The practical range most cited is 10–20 hard sets per muscle a week.',
    apply: 'Here: the bars mark that range (with their own bands for quads, hamstrings, glutes and calves when you split them). Adjust sets with − / +.',
    links: [['Pelland et al. · weekly volume and frequency, 67 studies (preprint)', 'https://sportrxiv.org/index.php/server/preprint/view/460'],
      ['Schoenfeld et al. 2017 · weekly volume dose-response', 'https://researchgate.net/profile/Brad-Schoenfeld/publication/305455324_Dose-response_relationship_between_weekly_resistance_training_volume_and_increases_in_muscle_mass_A_systematic_review_and_meta-analysis/links/59dc0269458515e9ab4527d6/Dose-response-relationship-between-weekly-resistance-training-volume-and-increases-in-muscle-mass-A-systematic-review-and-meta-analysis.pdf']] },
  { title: 'Volume per session and frequency', body: 'Per session, the gain per set drops after about 11 fractional sets per muscle. With volume equal, training a muscle more or fewer times a week changes growth little.',
    apply: 'Here: each muscle is spread over two days or more. Choose the split by the days you can train, not by frequency.',
    links: [['Remmert et al. · volume per session (preprint)', 'https://sportrxiv.org/index.php/server/preprint/view/537'],
      ['Schoenfeld, Grgic & Krieger 2019 · frequency and hypertrophy', 'https://ro.ecu.edu.au/ecuworkspost2013/5665']] },
  { title: 'Close to failure, not always to it', body: 'Getting closer to failure goes with more growth, but in an 8-week trial stopping 1–2 reps short grew about as much as reaching failure.',
    apply: 'Here: RIR 2–3 for beginners, 1–2 for intermediates and 0–2 for advanced lifters (0 only on isolation work).',
    links: [['Refalo et al. 2023 · proximity to failure (Sports Medicine)', 'https://openrepository.aut.ac.nz/bitstreams/9e3df52b-a8b3-4139-b172-feefd51e5334/download'],
      ['Robinson et al. · RIR and gains (meta-regression)', 'https://sportrxiv.org/index.php/server/preprint/download/295/699/654']] },
  { title: 'Order within the session', body: 'Growth comes out about the same in any order, but strength improves more on the exercises done first.',
    apply: 'Here: the main slot (a compound) goes first because it is the one you most want to progress in load; isolation work goes last.',
    links: [['Nunes et al. 2020 · exercise order (Eur J Sport Sci)', 'https://lida.sport-iat.de/ta/Record/4059795?lng=en']] },
  { title: 'Which exercise within the pattern', body: 'Training a muscle in its stretched position tends to grow it more: the seated leg curl beat the lying one, and the overhead triceps extension beat the arms-at-the-sides one.',
    apply: 'Here: the default suggestions lean to the seated leg curl, the overhead triceps extension and the incline curl. Your call.',
    links: [['Review on muscle length and hypertrophy (preprint)', 'https://sportrxiv.org/index.php/server/preprint/view/486/version/622']] },
  { title: 'Vary with a plan, not at random', body: 'Some planned variation helps regional growth; changing exercises too often can hold gains back.',
    apply: 'Here: keep the exercises through a mesocycle (3–5 microcycles) and change them within the same pattern when the next one starts.',
    links: [['Kassiano et al. 2022 · exercise variation (JSCR)', 'https://lida.sport-iat.de/ta/Record/4077216?lng=en']] },
  { title: 'Reference programs', body: 'Reference PPL programs open each day with one or two compounds, use 6–12 reps on compounds and 8–15 on isolation work, RIR 1–2 and deloads every few weeks.',
    apply: 'Here: the ranges follow the app’s double progression (compound 5–12, machine 8–10, isolation 10–20) and the app suggests the deload when the mesocycle closes.',
    links: [['Boostcamp · Push-Pull-Legs', 'https://www.boostcamp.app/methodology/push-pull-legs']] },
]

function Science() {
  return <section className="pg-stack" aria-labelledby="pg-h-sci" style={{ gap: 12 }}>
    <div>
      <h2 id="pg-h-sci">{t('Why it is built this way')}</h2>
      <p className="pg-lead">{t('What the research says and how this plan applies it. Several sources are preprints not yet peer reviewed; they are marked.')}</p>
    </div>
    <div className="pg-science">
      {CARDS.map(c => <article key={c.title} className="pg-card">
        <h3>{t(c.title)}</h3>
        <p>{t(c.body)}</p>
        <p className="apply">{t(c.apply)}</p>
        {c.links.map(([label, href]) => <a key={href} href={href} target="_blank" rel="noopener noreferrer">{label}</a>)}
      </article>)}
    </div>
  </section>
}

/* ---------- the exercises of one slot ---------- */

function Picker({ slot, profile, dayName, onPick, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  // The groups are fixed when the sheet opens, so a heart tapped here does not move rows under
  // the finger; they re-sort the next time it is opened.
  const [groups] = useState(() => candidatesFor(useStore.getState().S, slot, profile))
  const [q, setQ] = useState('')
  const total = groups.favorites.length + groups.owned.length + groups.rest.length
  const rows = list => (q.trim() ? list.filter(e => matchExercise(e, q)) : list).map(e => {
    const fav = isFavorite(S, e.id)
    return <div key={e.id} className={'pg-opt' + (e.id === slot.id ? ' sel' : '')}>
      <button className="choose" onClick={() => { onPick(e.id); close() }}>
        <div className="pg-exn" style={{ fontSize: 15 }}>{exerciseNameFor(e)}</div>
        {e.n && !exerciseNameFor(e).toLowerCase().includes(e.n.toLowerCase()) && <div className="en">{e.n}</div>}
        <div className="pg-meta">
          <span className="pg-tag">{t(e.eq)}</span><span className="pg-tag">{t(CLASS_NAME[clsKey(e)])}</span>
          {ownsEquipment(profile, e) === false && <span className="pg-tag warn">{t('not in your equipment')}</span>}
          {e.id === slot.id && <span className="pg-tag pick">{t('current')}</span>}
        </div>
      </button>
      <button className="pg-heart" aria-pressed={fav} aria-label={fav ? t('Remove from favourites') : t('Add to favourites')}
        onClick={() => update(s => { toggleFavorite(s, e.id) })}>{fav ? '♥' : '♡'}</button>
    </div>
  })
  const section = (title, list, empty) => {
    const r = rows(list)
    return <>
      <div className="pg-grp"><h3>{title}</h3><span className="c">{list.length}</span></div>
      {r.length ? r : <div className="pg-empty">{q.trim() ? t('No match') : empty}</div>}
    </>
  }
  return <>
    <div className="pg-sh-head">
      <div className="pg-row pg-between"><span className="pg-label">{dayName} · {t(ROLE[slot.role])}</span><button className="pg-close" onClick={close}>{t('Close')}</button></div>
      <h2 style={{ fontSize: 24 }}>{t(patternName(slot.pattern))}</h2>
      <p className="pg-hint">{t('{0} exercises in the pattern. Order: your favourites ♥, then what your equipment allows, then the rest.', total)}</p>
    </div>
    <div className="pg-sh-tools">
      <input className="pg-search picker-search" type="search" value={q} onChange={e => setQ(e.target.value)}
        placeholder={t('Search by name or equipment')} aria-label={t('Search…')} />
      {slot.picked && <button className="pg-link" style={{ justifySelf: 'start' }} onClick={() => { onPick(null); close() }}>{t('Back to the suggestion')}</button>}
    </div>
    <div>
      {section('♥ ' + t('Favourites'), groups.favorites, t('No favourites in this pattern yet — tap the heart on any exercise.'))}
      {section(profile ? t('With “{0}”', profile.name) : t('Available'), groups.owned, t('None with this equipment.'))}
      {profile && section(t('Others'), groups.rest, t('None — your equipment covers the whole pattern.'))}
    </div>
  </>
}

const openPicker = ({ slot, profile, dayName, onPick }) =>
  useUI.getState().openSheet(close => <Picker slot={slot} profile={profile} dayName={dayName} onPick={onPick} close={close} />,
    { className: 'side pg' })
