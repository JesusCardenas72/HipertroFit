import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import LineChart from './LineChart.jsx'
import NumField from './NumField.jsx'
import { Button, DateField } from './ui.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum, fmtDate, todayISO } from '../lib/format.js'
import { MEASURES, MEASURE_NAME, lengthUnit, measuresOf, addMeasure, removeMeasure, seriesOf, measuredKeys, trendOf } from '../lib/measures.js'
import { listPhotos, addPhoto, deletePhoto, comparePair } from '../lib/progress-photos.js'

// Stats ▸ Measurements and progress photos: what the scale cannot show. The measurements live in
// S (lib/measures.js) and travel with it; the photos stay on this device (lib/progress-photos.js).

const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmtNum(Math.abs(n))

/* ---------- log one day's measurements ---------- */
function MeasureSheet({ close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const list = measuresOf(S)
  const u = lengthUnit(S)
  const [d, setD] = useState(todayISO())
  const [vals, setVals] = useState({})
  const last = k => { const tr = trendOf(list, k); return tr ? fmtNum(tr.v) : '' }
  const save = () => {
    const any = MEASURES.some(k => vals[k] > 0)
    if (!any) { useUI.getState().toast(t('Enter at least one measurement')); return }
    update(s => { s.measures = addMeasure(measuresOf(s), { d, ...vals }) })
    useUI.getState().toast(t('Measurements saved'))
    close()
  }
  return <>
    <h3>{t('Log measurements')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Measure relaxed, at the same time of day, at the widest point. Leave blank what you did not measure.')}</div>
    <div style={{ marginBottom: 10 }}><DateField value={d} max={todayISO()} onChange={setD} /></div>
    <div className="sect-b" style={{ marginBottom: 14 }}>
      {MEASURES.map(k => <div key={k} className="lrow">
        <span className="lrow-m"><span className="lrow-t">{t(MEASURE_NAME[k])}</span></span>
        <span className="row" style={{ gap: 6, alignItems: 'center' }}>
          <NumField nullable value={vals[k] ?? null} placeholder={last(k)} style={{ width: 70, textAlign: 'right' }}
            onChange={v => setVals(x => ({ ...x, [k]: v }))} />
          <span className="dim small">{u}</span>
        </span>
      </div>)}
    </div>
    <Button variant="primary" icon="check" onClick={save}>{t('Save')}</Button>
    {list.length > 0 && <>
      <h4 className="sec">{t('Recent')}</h4>
      <div className="sect-b">
        {list.slice(-4).reverse().map(e => <div key={e.d} className="lrow">
          <span className="lrow-m"><span className="lrow-t">{fmtDate(e.d, true)}</span>
            <span className="lrow-s">{MEASURES.filter(k => e[k]).map(k => t(MEASURE_NAME[k]) + ' ' + fmtNum(e[k])).join(' · ')}</span></span>
          <button className="iconbtn" aria-label={t('Delete')} onClick={() => update(s => { s.measures = removeMeasure(measuresOf(s), e.d) })}><Icon name="trash" /></button>
        </div>)}
      </div>
    </>}
  </>
}
export const measureSheet = () => useUI.getState().openSheet(close => <MeasureSheet close={close} />)

/* ---------- one photo, and two side by side ---------- */
function PhotoView({ photo, close, onDeleted }) {
  return <div style={{ textAlign: 'center' }}>
    <img src={photo.img} alt={fmtDate(photo.d, true)} style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 12 }} />
    <div className="row between" style={{ marginTop: 10 }}>
      <span className="muted">{fmtDate(photo.d, true, true)}</span>
      <Button size="sm" icon="trash" onClick={async () => { await deletePhoto(photo.id).catch(() => {}); close(); onDeleted() }}>{t('Delete')}</Button>
    </div>
  </div>
}
function CompareView({ pair }) {
  return <div>
    <h3>{t('Compare')}</h3>
    <div className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
      {[pair.before, pair.after].map(p => <figure key={p.id} style={{ flex: 1, margin: 0, textAlign: 'center' }}>
        <img src={p.img} alt={fmtDate(p.d, true)} style={{ width: '100%', borderRadius: 10 }} />
        <figcaption className="small muted">{fmtDate(p.d, true, true)}</figcaption>
      </figure>)}
    </div>
  </div>
}

function Photos() {
  const [photos, setPhotos] = useState(null)
  const input = useRef(null)
  const reload = () => listPhotos().then(setPhotos)
  useEffect(() => { reload() }, [])
  const pick = async e => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    try { await addPhoto(file, todayISO()); reload() } catch (err) { useUI.getState().toast(t('That file is not an image')) }
  }
  const open = p => useUI.getState().openSheet(close => <PhotoView photo={p} close={close} onDeleted={reload} />)
  const pair = photos ? comparePair(photos) : null
  return <>
    <div className="row between" style={{ margin: '14px 0 8px' }}>
      <h4 className="sec" style={{ margin: 0 }}>{t('Progress photos')}</h4>
      <div className="row" style={{ gap: 8 }}>
        {pair && <Button size="sm" icon="copy" onClick={() => useUI.getState().openSheet(() => <CompareView pair={pair} />)}>{t('Compare')}</Button>}
        <Button size="sm" icon="plus" onClick={() => input.current && input.current.click()}>{t('Add')}</Button>
      </div>
    </div>
    <input ref={input} type="file" accept="image/*" style={{ display: 'none' }} onChange={pick} data-testid="photo-input" />
    {photos && photos.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
      {photos.slice(0, 9).map(p => <button key={p.id} type="button" onClick={() => open(p)} aria-label={fmtDate(p.d, true)}
        style={{ padding: 0, border: 0, background: 'none', position: 'relative' }}>
        <img src={p.img} alt="" style={{ width: '100%', aspectRatio: '3 / 4', objectFit: 'cover', borderRadius: 8, display: 'block' }} />
        <span className="small" style={{ position: 'absolute', left: 4, bottom: 4, background: 'rgba(0,0,0,.55)', color: '#fff', borderRadius: 6, padding: '0 5px' }}>{fmtDate(p.d)}</span>
      </button>)}
    </div>}
    <div className="small dim" style={{ marginTop: 8 }}>{t('Photos stay on this device only: they are not synced and are not in the backup.')}</div>
  </>
}

/* ---------- the card ---------- */
export default function MeasuresCard({ S }) {
  const list = measuresOf(S)
  const keys = measuredKeys(list)
  const [sel, setSel] = useState(null)
  const key = keys.includes(sel) ? sel : keys[0]
  const u = lengthUnit(S)
  const tr = key ? trendOf(list, key) : null
  return <div className="card" data-testid="measures-card">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Measurements')}</h2>
      <Button size="sm" icon="plus" onClick={measureSheet}>{t('Log')}</Button>
    </div>
    {keys.length ? <>
      <div className="chips" style={{ marginBottom: 8 }}>
        {keys.map(k => <button key={k} type="button" className={'chip nocap' + (k === key ? ' on' : '')} onClick={() => setSel(k)}>{t(MEASURE_NAME[k])}</button>)}
      </div>
      <div className="chart"><LineChart points={seriesOf(list, key)} h={140} unit={u} color="var(--purple)" /></div>
      {tr && <div className="small dim" style={{ marginTop: 6 }}>
        <b className="accent">{fmtNum(tr.v)} {u}</b> · {t('{0} since {1}', signed(tr.delta) + ' ' + u, fmtDate(tr.since, true))}
      </div>}
    </> : <div className="muted small">{t('Measure arms, waist and the rest to see whether what grows is muscle, not fat.')}</div>}
    <Photos />
  </div>
}
