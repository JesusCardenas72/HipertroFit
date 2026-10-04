import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DAYN, uid, exCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, folderSheet, loadStarterPlan, planToolsSheet, programSheet } from '../sheets.jsx'
import { groupRoutines, toggleFolder } from '../lib/folders.js'
import { programActive } from '../lib/program.js'
import Icon from '../components/Icon.jsx'
import MicrocycleActions from '../components/MicrocycleActions.jsx'
import { Button } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }
  const { loose, folders } = groupRoutines(S)
  const routineRow = r => <div key={r.id} className="item" {...tappable(() => nav('/plan/r/' + r.id))}>
    <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
    <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
    <Icon name="chevronRight" className="chev" /></div>

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>
    <MicrocycleActions />
    <div className="cols"><div>
      <h4 className="sec">{t('Programming')}</h4>
      <div className="list" style={{ marginBottom: 6 }}>
        <div className="item" {...tappable(programSheet)}>
          <span className="lrow-i"><Icon name="calendar" /></span>
          <div className="grow">
            <div className="tt">{t('Day sequence')}</div>
            <div className="ss">{programActive(S.program)
              ? t('{0}-day cycle · active', S.program.seq.length)
              : t('Off — using weekly schedule')}</div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>
      </div>

      <h4 className="sec">{t('Week schedule')}</h4>
      {programActive(S.program) && <div className="small dim" style={{ margin: '-2px 0 8px' }}>{t('Overridden by the program while it is on.')}</div>}
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const r = S.routines.find(x => x.id === S.week[d])
          return <div key={d} className="item" {...tappable(() => dayAssignSheet(d))}>
            <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
            {r ? <span className="tag acc"><Icon name={glyphOf(r.emoji)} />{r.name}</span> : <span className="tag">{t('Rest')}</span>}
            <Icon name="chevronRight" className="chev" /></div>
        })}
      </div>
    </div><div>
      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" variant="tinted" icon="folder" onClick={() => folderSheet()} aria-label={t('New folder')} title={t('New folder')} />
          <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
        </div>
      </div>
      {S.routines.length || folders.length ? <div className="list">
        {folders.map(({ folder: f, routines }) => <div key={f.id} className={'folder' + (f.open ? ' open' : '')}>
          <div className="item folder-hd" aria-expanded={!!f.open} {...tappable(() => update(s => toggleFolder(s, f.id)))}>
            <span className="lrow-i"><Icon name="folder" /></span>
            <div className="grow"><div className="tt">{f.name}</div>
              <div className="ss">{t(routines.length === 1 ? '{0} routine' : '{0} routines', routines.length)}</div></div>
            <button className="iconbtn" aria-label={t('Edit folder')} title={t('Edit folder')}
              onClick={e => { e.stopPropagation(); folderSheet(f) }}><Icon name="pencil" /></button>
            <Icon name={f.open ? 'chevronUp' : 'chevronDown'} className="chev" />
          </div>
          {f.open && <div className="list folder-body">
            {routines.length ? routines.map(routineRow)
              : <div className="small dim folder-empty">{t('Empty folder — open a routine and pick this folder, or add one from the folder menu.')}</div>}
          </div>}
        </div>)}
        {loose.map(routineRow)}
      </div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
      </>}
    </div></div>
  </>
}
