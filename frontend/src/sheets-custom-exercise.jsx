// Custom exercises: creating one (from scratch or as a copy), its picture, muscles and
// movement pattern, and editing or deleting it. Split out of sheets.jsx, which re-exports
// everything public here, so importers keep using './sheets.jsx'.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXIDX, BODYPARTS, allExercises, normalizeStr, muscleTagsOf, catalogueRow, imgSrc, gifSrc } from './lib/exercises.js'
import { ALL_EQUIPMENT } from './lib/equipment.js'
import { uid } from './lib/format.js'
import { cleanupSg } from './lib/history.js'
import { t, instrFor, exerciseNameFor, exerciseNameOverrideFor, catalogueNameFor } from './lib/i18n.js'
import Media from './components/Media.jsx'
import Icon from './components/Icon.jsx'
import { Button, Slider, SelectRow, TextField, MultiSelectRow } from './components/ui.jsx'
import { exerciseMuscleSnapshot, MUSCLE_CHOICES, muscleLabel, muscleChoiceOf } from './lib/muscles.js'
import { classifyExercise, CLASS_NAME, CLASS_REP_RANGE, EXERCISE_CLASSES } from './lib/exercise-class.js'
import { buildCustomExercise, stepsText, copyName, NAME_MAX, DESC_MAX, MAX_IMAGE_BYTES } from './lib/custom-exercise.js'
import { pictureFromFile, pictureFromUrl, pictureFromClipboard, imageFromTransfer, gifFromDataUrl, frameCanvas, frameToJpeg } from './lib/image-file.js'
import { SUPPLEMENT_SOURCES, loadSource, freshOnly, importSeed, normName } from './lib/supplement-catalogue.js'
import { PATTERNS, patternOf } from './lib/movement-patterns.js'
import { useSheetKeyboard } from './lib/use-sheet-keyboard.js'
import { confirmSheet } from './sheets.jsx'

const S = () => useStore.getState().S
const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)

/* ============================ custom exercises (issue #11) ============================ */
// An exercise that is not in the catalogue is fully yours: every field a catalogue row has
// (name, body part, equipment, muscles, class, instructions, picture) can be set here, and it
// then behaves like any built-in one (planning, logging, PRs, stats). Only name and body part
// are required. The record itself is built by buildCustomExercise (lib/custom-exercise.js).
// `copyOf` starts a new exercise from another one (built-in or custom): every field, the
// instructions in the current language and the picture are filled in from it, under a name
// that is still free, and the copy is saved as a separate custom exercise.
// `importOf` starts a new exercise from a supplementary source (lib/supplement-catalogue.js):
// the same fields as a copy, the picture downloaded from the source, and its credit kept on save.
function CustomExForm({ existing, copyOf, prefill, importOf, onDone, close }) {
  const nameRef = useRef(null)
  const fileRef = useRef(null)
  const onNameFocus = useSheetKeyboard(nameRef)
  const src = existing || copyOf || (importOf && importOf.row)
  const [n, setN] = useState(() => existing ? existing.n
    : copyOf ? copyName(exerciseNameFor(copyOf), allExercises(S()).flatMap(e => [e.n, exerciseNameFor(e)]), t('copy'))
    : importOf ? importOf.row.n
    : (prefill || ''))
  const [bp, setBp] = useState(src ? src.bp : '')
  const [eq, setEq] = useState(src && src.eq && src.eq !== 'custom' ? src.eq : '')
  // A built-in's class may come from an override keyed by its id, which the copy will not have.
  const [cls, setCls] = useState(() => copyOf && !copyOf.custom ? classifyExercise(copyOf) : importOf ? classifyExercise(importOf.row) : (src && src.cls) || '')
  const [pattern, setPattern] = useState(src ? patternOf(src) || '' : '')
  const [desc, setDesc] = useState(src ? (src.desc || '') : '')
  const [steps, setSteps] = useState(existing ? stepsText(existing.st) : copyOf ? stepsText(instrFor(copyOf)) : importOf ? stepsText(importOf.row.st) : '')
  const [pic, setPic] = useState(() => src && src.custom ? { img: src.img || '', gif: src.gif || '', frame: src.frame || 0 } : { img: '', gif: '', frame: 0 })
  const [picBusy, setPicBusy] = useState(false)
  const [muscles, setMuscles] = useState(() => initialMuscles(src))
  const takePicture = async load => {
    setPicBusy(true)
    try { setPic(await load()) }
    catch (err) { toast(pictureError(err)) }
    finally { setPicBusy(false) }
  }
  const pickPicture = e => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (file) takePicture(() => pictureFromFile(file))
  }
  // A built-in's media is a file next to the app, not inline: download it so the copy owns it.
  // The animation first, its still when the GIF is over the size cap or cannot be read.
  useEffect(() => {
    if (!copyOf || copyOf.custom || (!copyOf.img && !copyOf.gif)) return
    takePicture(async () => {
      if (copyOf.gif) try { return await pictureFromUrl(gifSrc(copyOf)) } catch { /* fall back to the still */ }
      try { return await pictureFromUrl(imgSrc(copyOf)) } catch { throw new Error('copy') }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // An imported exercise's picture comes from its source; without one the form just has none.
  useEffect(() => {
    if (!importOf || !importOf.row.imageUrl) return
    takePicture(() => pictureFromUrl(importOf.row.imageUrl))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // An image copied in the browser can be pasted straight in (Ctrl+V / long-press → Paste)
  // or dropped on the image section; text pastes into the fields are left alone.
  useEffect(() => {
    const onPaste = e => {
      const file = imageFromTransfer(e.clipboardData)
      if (!file) return
      e.preventDefault()
      takePicture(() => pictureFromFile(file))
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const onDrop = e => {
    e.preventDefault()
    const file = imageFromTransfer(e.dataTransfer)
    const url = (e.dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).find(l => l && !l.startsWith('#'))
    if (file) takePicture(() => pictureFromFile(file))
    else if (url) takePicture(() => pictureFromUrl(url.trim()))
  }
  const searchWeb = () => {
    const q = n.trim()
    if (!q) { toast(t('Give it a name')); return }
    window.open('https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(q), '_blank', 'noopener')
  }
  const draft = id => buildCustomExercise({ id, n, bp, eq, cls, pattern, primaries: muscles.primary, secondaries: muscles.secondary, desc, steps, img: pic.img, gif: pic.gif, frame: pic.frame, credit: importOf ? importOf.row.credit : (existing || {}).credit, src: importOf ? importOf.row.src : (existing || {}).src })
  const autoCls = classifyExercise({ ...draft((existing || {}).id), cls: undefined })
  const save = () => {
    const name = n.trim()
    if (!name) { toast(t('Give it a name')); return }
    if (!bp) { toast(t('Pick a body part')); return }
    const dup = allExercises(S()).find(e => e.n.toLowerCase() === name.toLowerCase() && e.id !== (existing || {}).id)
    if (dup) { toast(t('“{0}” already exists', dup.n)); return }
    if (picBusy) { toast(t('Loading image…')); return }
    const id = existing ? existing.id : 'c' + uid()
    const record = draft(id)
    update(s => {
      s.customEx = s.customEx || []
      const i = s.customEx.findIndex(x => x.id === id)
      if (i >= 0) s.customEx[i] = record
      else if (!existing) s.customEx.push(record)
    })
    close()
    toast(existing ? t('Saved') : t('“{0}” created', record.n))
    onDone && onDone(EXIDX[id])
  }
  const openFile = () => fileRef.current && fileRef.current.click()
  const eqOptions = [{ value: '', label: t('custom') }, ...ALL_EQUIPMENT.map(x => ({ value: x, label: t(x) }))]
  const clsOptions = [{ value: '', label: t('Automatic · {0}', t(CLASS_NAME[autoCls])) },
    ...EXERCISE_CLASSES.map(c => ({ value: c, label: t(CLASS_NAME[c]), subtitle: t('{0}–{1} reps', CLASS_REP_RANGE[c].repsMin, CLASS_REP_RANGE[c].reps) }))]
  return <>
    <h3>{existing ? t('Edit custom exercise') : copyOf ? t('Copy of “{0}”', exerciseNameFor(copyOf)) : t('Create your own exercise')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Only the name and body part are required — fill in the rest to describe it as fully as a built-in exercise.')}</div>
    <input ref={nameRef} className="input" maxLength={NAME_MAX} placeholder={t('Exercise name')} value={n} onFocus={onNameFocus} onChange={e => setN(e.target.value)} />
    <div className="chips" style={{ margin: '12px 0' }}>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => setBp(b)}>{t(b)}</button>)}
    </div>
    <SelectRow title={t('Equipment')} value={eq} options={eqOptions} onChange={setEq}
      search={{ placeholder: t('Search…'), label: t('Search…'), emptyLabel: t('No match'), match: (o, q) => normalizeStr(o.label + ' ' + o.value).includes(normalizeStr(q.trim())) }} />
    {/* Shown before a body part is picked too: the muscles are as much a part of describing
        the exercise as its name, and hiding them until a chip is tapped made them easy to miss. */}
    {bp !== 'cardio' && <MusclePickers value={muscles} onChange={setMuscles} />}
    {bp && bp !== 'cardio' && <SelectRow title={t('Exercise type')} value={cls} options={clsOptions} onChange={setCls} />}
    {bp && bp !== 'cardio' && <SelectRow title={t('Movement pattern')} value={pattern} onChange={setPattern}
      options={[{ value: '', label: t('None') }, ...PATTERNS.map(p => ({ value: p.key, label: t(p.name) }))]} />}
    {bp === 'cardio' && <div className="small dim row" style={{ margin: '10px 0', gap: 5 }}><Icon name="figureRun" style={{ fontSize: 13 }} />{t('Cardio exercises log time + speed instead of weight × reps.')}</div>}
    <h4 className="sec">{t('Image')}</h4>
    <div onDragOver={e => e.preventDefault()} onDrop={onDrop}>
    <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,.mp4,.webm" hidden onChange={pickPicture} />
    {picBusy ? <div className="small dim" style={{ marginBottom: 12 }}>{t('Loading image…')}</div> : pic.img ? <>
      <Media ex={{ id: 'preview', n, img: pic.img, gif: pic.gif }} compact />
      {pic.gif && <GifFramePicker src={pic.gif} frame={pic.frame} onPick={(frame, img) => setPic(p => ({ ...p, frame, img }))} />}
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <Button icon="pencil" style={{ flex: 1 }} onClick={openFile}>{t('Change image')}</Button>
        <Button variant="danger" icon="trash" style={{ flex: 1 }} onClick={() => setPic({ img: '', gif: '', frame: 0 })}>{t('Remove image')}</Button>
      </div>
    </> : <Button icon="plus" style={{ marginBottom: 8 }} onClick={openFile}>{t('Add an image')}</Button>}
    <div className="row" style={{ gap: 8, marginBottom: 6 }}>
      <Button icon="globe" style={{ flex: 1 }} onClick={searchWeb}>{t('Search the web')}</Button>
      <Button icon="clipboard" style={{ flex: 1 }} disabled={picBusy} onClick={() => takePicture(pictureFromClipboard)}>{t('Paste image')}</Button>
    </div>
    <div className="small dim" style={{ marginBottom: 12 }}>{t('Find a picture in your browser, copy it (right-click or long-press → Copy image) and come back to paste it — Ctrl+V or dropping it here works too.')}</div>
    </div>
    <h4 className="sec">{t('How to')}</h4>
    <textarea className="input" rows={4} placeholder={t('Instructions (optional) — one step per line')}
      value={steps} onChange={e => setSteps(e.target.value)} style={{ marginBottom: 10 }} />
    <textarea className="input" rows={3} maxLength={DESC_MAX} placeholder={t('Description (optional) — setup, cues, anything you want to remember')}
      value={desc} onChange={e => setDesc(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Create exercise')}</Button>
    {existing && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { close(); deleteCustomEx(existing) }}>{t('Delete exercise')}</Button></>}
  </>
}
// Scrub through an animated GIF and pick the frame that becomes the exercise's still (list
// thumbnail, paused picture). The frame is drawn straight from the decoder while dragging;
// the JPEG is only encoded once the slider settles.
function GifFramePicker({ src, frame, onPick }) {
  const gif = useMemo(() => gifFromDataUrl(src), [src])
  const canvasRef = useRef(null)
  const [cur, setCur] = useState(frame)
  const count = gif ? gif.frames.length : 0
  useEffect(() => { setCur(Math.min(frame, Math.max(0, count - 1))) }, [src]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!gif || !canvasRef.current) return
    frameCanvas(gif, cur, canvasRef.current)
    if (cur === frame) return
    const tm = setTimeout(() => onPick(cur, frameToJpeg(gif, cur)), 200)
    return () => clearTimeout(tm)
  }, [gif, cur]) // eslint-disable-line react-hooks/exhaustive-deps
  if (count < 2) return null
  return <div className="gifpick">
    <div className="row between" style={{ marginBottom: 8 }}>
      <span className="small">{t('Thumbnail')}</span>
      <span className="small dim">{t('Frame {0} of {1}', cur + 1, count)}</span>
    </div>
    <div className="row" style={{ gap: 12, alignItems: 'center' }}>
      <canvas ref={canvasRef} className="gifpick-frame" />
      <div className="grow">
        <Slider value={cur} min={0} max={count - 1} step={1} onChange={v => setCur(v)} />
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <Button icon="chevronLeft" style={{ flex: 1 }} disabled={cur <= 0} onClick={() => setCur(c => Math.max(0, c - 1))}>{t('Previous')}</Button>
          <Button icon="chevronRight" style={{ flex: 1 }} disabled={cur >= count - 1} onClick={() => setCur(c => Math.min(count - 1, c + 1))}>{t('Next')}</Button>
        </div>
      </div>
    </div>
  </div>
}

export const customExSheet = (existing, onDone, prefill, importOf) => ui().openSheet(close => <CustomExForm existing={existing} prefill={prefill} importOf={importOf} onDone={onDone} close={close} />)

// The supplementary sources: pick an exercise to open as a new custom exercise. The form then
// fills in from it, downloads its picture and keeps its credit; saving works like any other.
export const importExercisesSheet = () => ui().openSheet(close => <ImportExercisesSheet close={close} />)
function ImportExercisesSheet({ close }) {
  const [srcId, setSrcId] = useState(SUPPLEMENT_SOURCES[0].id)
  const [list, setList] = useState(null)
  const [failed, setFailed] = useState(false)
  const [q, setQ] = useState('')
  const taken = useMemo(() => allExercises(S()).flatMap(e => [e.n, exerciseNameFor(e)]), [])
  useEffect(() => {
    let live = true
    setList(null)
    setFailed(false)
    loadSource(srcId).then(l => { if (live) setList(l) }, () => { if (live) setFailed(true) })
    return () => { live = false }
  }, [srcId])
  const source = SUPPLEMENT_SOURCES.find(s => s.id === srcId)
  const needle = normName(q)
  const fresh = useMemo(() => list ? freshOnly(list, taken) : [], [list, taken])
  const shown = fresh.filter(c => !needle || normName(c.names.join(' ')).includes(needle)).slice(0, 60)
  return <>
    <h4 className="sec">{t('Import exercises')}</h4>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {SUPPLEMENT_SOURCES.map(s => <Button key={s.id} size="sm" variant={s.id === srcId ? 'tinted' : 'ghost'} onClick={() => setSrcId(s.id)}>{s.name}</Button>)}
    </div>
    <TextField value={q} onChange={e => setQ(e.target.value)} placeholder={t('Search…')} style={{ marginBottom: 8 }} />
    {failed ? <div className="small dim">{t('Could not reach {0}. Try again later.', source.name)}</div>
      : !list ? <div className="small dim">{t('Loading…')}</div>
      : <div className="list">
        {shown.map(c => <div key={c.key} className="item" onClick={() => { close(); customExSheet(null, undefined, undefined, { row: importSeed(c) }) }}>
          <div className="grow"><div className="tt capitalize">{c.n}</div><div className="ss capitalize">{[c.bp && t(c.bp), c.eq && t(c.eq)].filter(Boolean).join(' · ')}</div></div>
          <Icon name="plus" className="chev" />
        </div>)}
        {!shown.length && <div className="small dim">{t('Nothing new to import')}</div>}
      </div>}
    <div className="small dim" style={{ marginTop: 10 }}>{source.credit}</div>
  </>
}
export const copyExSheet = (ex, onDone) => ui().openSheet(close => <CustomExForm copyOf={ex} onDone={onDone} close={close} />)

function pictureError(err) {
  switch (err && err.message) {
    case 'too-large': return t('That GIF is too big — keep it under {0} KB', Math.round(MAX_IMAGE_BYTES / 1024))
    case 'copy': return t('Couldn’t copy its picture — add one below')
    case 'fetch': return t('Couldn’t download that image — copy the image itself (Copy image), not its address')
    case 'no-image': return t('There’s no image on the clipboard — copy one first (Copy image)')
    case 'denied': return t('The browser didn’t allow reading the clipboard — press Ctrl+V here instead')
    case 'unsupported': return t('Can’t read the clipboard here — press Ctrl+V or long-press and Paste')
    default: return t('That file isn’t an image')
  }
}

/* ---- muscle groups ----
   The primary / secondary pickers shared by the custom-exercise form and the muscle editor of a
   built-in exercise. `value` = { primary, secondary } of MUSCLE_CHOICES slugs; a muscle is never
   in both lists, so picking it as primary takes it out of the secondaries. */
function initialMuscles(ex) {
  const { primary, secondary } = ex ? muscleTagsOf(ex) : { primary: [], secondary: [] }
  const pick = list => [...new Set(list.map(muscleChoiceOf).filter(Boolean))]
  const p = pick(primary)
  return { primary: p, secondary: pick(secondary).filter(m => !p.includes(m)) }
}

function MusclePickers({ value, onChange }) {
  const toggle = (list, m) => list.includes(m) ? list.filter(x => x !== m) : [...list, m]
  const option = m => ({ value: m, label: t(muscleLabel(m)) })
  return <>
    <MultiSelectRow title={t('Primary muscle groups')} sheetTitle={t('Primary muscle groups')}
      values={value.primary} options={MUSCLE_CHOICES.map(option)}
      onToggle={m => onChange(v => {
        const primary = toggle(v.primary, m)
        return { primary, secondary: v.secondary.filter(x => !primary.includes(x)) }
      })}
      noneLabel={t('No explicit muscle group')} doneLabel={t('Done')} />
    <MultiSelectRow title={t('Secondary muscle groups')} sheetTitle={t('Secondary muscle groups')}
      values={value.secondary} options={MUSCLE_CHOICES.filter(m => !value.primary.includes(m)).map(option)}
      onToggle={m => onChange(v => ({ ...v, secondary: toggle(v.secondary, m) }))}
      noneLabel={t('No explicit muscle group')} doneLabel={t('Done')} />
  </>
}

/* A built-in exercise's muscles, corrected by hand. The catalogue row stays as shipped; the
   correction lives in S.exMuscles and lib/exercises.js applies it to every lookup, so volume,
   recovery, the muscle map and stats all count the exercise the way you set it — history
   included, since logged sets point at the exercise rather than copying its muscles. */
function MuscleEditForm({ ex, close }) {
  const original = catalogueRow(ex.id) || ex
  const [muscles, setMuscles] = useState(() => initialMuscles(ex))
  const edited = !!(S().exMuscles || {})[ex.id]
  const write = value => update(s => {
    s.exMuscles = { ...(s.exMuscles || {}) }
    if (value) s.exMuscles[ex.id] = value
    else delete s.exMuscles[ex.id]
  })
  const save = () => {
    if (!muscles.primary.length) { toast(t('Pick at least one primary muscle group')); return }
    write({ primaries: muscles.primary, secondaries: muscles.secondary })
    close()
    toast(t('Saved'))
  }
  const restore = () => { write(null); close(); toast(t('Original muscles restored')) }
  const shipped = initialMuscles(original)
  return <>
    <h3>{t('Edit muscle groups')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Volume, recovery and the muscle map will count this exercise with these muscles — past workouts included.')}</div>
    <MusclePickers value={muscles} onChange={setMuscles} />
    <div className="small dim" style={{ margin: '10px 0 14px' }}>
      {t('Original:')} {shipped.primary.map(m => t(muscleLabel(m))).join(', ')}
      {shipped.secondary.length > 0 && <> · {shipped.secondary.map(m => t(muscleLabel(m))).join(', ')}</>}
    </div>
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {edited && <><div style={{ height: 8 }} /><Button icon="reset" onClick={restore}>{t('Restore original muscles')}</Button></>}
  </>
}
export const muscleEditSheet = ex => ui().openSheet(close => <MuscleEditForm ex={ex} close={close} />)

/* ---- manual rename ----
   A built-in exercise's id and animation come from the catalogue (a dataset refresh owns
   them; its muscles can be corrected, see MuscleEditForm), but what it is *called* is yours: the catalogue name is
   often a mouthful, a translation may not be the word your gym uses, and the English term in
   parentheses is noise once you know the exercise. So the name alone is overridable, stored
   apart from the catalogue in S.exNames and applied by exerciseNameFor everywhere at once.
   Clearing the field restores the catalogue name — that is the undo, so there is no separate
   reset button to explain. */
function RenameExForm({ ex, close }) {
  const nameRef = useRef(null)
  const onNameFocus = useSheetKeyboard(nameRef)
  const original = catalogueNameFor(ex)
  const [n, setN] = useState(() => exerciseNameOverrideFor(ex))
  const save = () => {
    const name = n.trim()
    const dup = allExercises(S()).find(e => e.id !== ex.id && exerciseNameFor(e).toLowerCase() === name.toLowerCase())
    if (name && dup) { toast(t('“{0}” already exists', exerciseNameFor(dup))); return }
    update(s => {
      s.exNames = { ...(s.exNames || {}) }
      if (name) s.exNames[ex.id] = name
      else delete s.exNames[ex.id]
    })
    close()
    toast(name ? t('Saved') : t('Original name restored'))
  }
  return <>
    <h3>{t('Rename this exercise')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Only the name changes — your routines, history and stats keep pointing at the same exercise. Leave it empty to go back to “{0}”.', original)}</div>
    <input ref={nameRef} className="input" placeholder={original} value={n} onFocus={onNameFocus} onChange={e => setN(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const renameExSheet = ex => ui().openSheet(close => <RenameExForm ex={ex} close={close} />)

export function deleteCustomEx(ex, afterDelete) {
  if (S().active?.entries.some(e => e.id === ex.id)) { toast(t('Finish your current workout first')); return }
  confirmSheet({
    title: t('Delete “{0}”?', ex.n),
    message: t('It will be removed from your routines. Already-logged workouts keep their sets.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      update(s => {
        // Keep display and muscle metadata in history before the custom catalogue row disappears.
        const snapshot = exerciseMuscleSnapshot(ex)
        s.workouts.forEach(w => w.entries.forEach(e => {
          if (e.id !== ex.id) return
          e.n = ex.n
          if (!e.muscleSnapshot || !Object.keys(e.muscleSnapshot).length) e.muscleSnapshot = snapshot
        }))
        s.customEx = (s.customEx || []).filter(x => x.id !== ex.id)
        s.routines.forEach(r => { r.ex = r.ex.filter(e => e.id !== ex.id); cleanupSg(r.ex) })
        delete s.exWeights[ex.id]
      })
      toast(t('Exercise deleted'))
      afterDelete && afterDelete()
    }
  })
}
