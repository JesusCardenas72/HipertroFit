import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { Button, Segmented } from './ui.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, exerciseNameFor, getLang } from '../lib/i18n.js'
import { fmtNum, fmtDate, todayISO } from '../lib/format.js'
import { EXIDX } from '../lib/exercises.js'
import { VOLUME_GROUPS } from '../lib/volume.js'
import { MOBILE } from '../lib/mobile.js'
import { api } from '../lib/api.js'
import { buildDigest } from '../lib/ai-digest.js'
import { buildPrompt, approxTokens } from '../lib/ai-prompt.js'
import { reportOf, addReport, removeReport, aiErrorKey, providerNotice, actionKey } from '../lib/ai-report.js'
import { loadByok, byokReady, callProvider, hostOf } from '../lib/ai-provider.js'
import { aiProviderSheet } from './AiProviderSheet.jsx'
import { proposalFor, applyProposal } from '../lib/ai-actions.js'
import { confirmSheet } from '../sheets.jsx'

// "Analyze with AI". Three ways out, all starting from the same digest (lib/ai-digest.js):
//   - Server relay: signed in, on a server whose operator configured a provider (AI_BASE_URL /
//     AI_MODEL). The browser builds the prompt, the server adds the key and forwards it (api/ai.js).
//   - Your own key: when the server offers no provider (guests, the standalone mobile app, a server
//     without AI), the user can set a provider and key on this device and the request goes
//     straight to it (lib/ai-provider.js). The server relay wins when both exist.
//   - Copy / share the prompt: always there, no provider at all.
// Answers from either provider are kept in S.aiReports. The sheet names the host before sending.
// Nothing is sent without the user pressing a button that says where it goes.

const groupName = key => t((VOLUME_GROUPS.find(g => g.key === key) || {}).name || key)

// Finding → [icon, colour, text]. Types come from findingsOf; unknown ones are skipped.
const FINDING = {
  'deload-mandatory': f => ['warning', 'var(--red)', t('Deload due: {0} loading microcycles in a row.', f.loading_microcycles)],
  'deload-suggested': f => ['info', 'var(--orange)', t('Deload suggested after {0} loading microcycles.', f.loading_microcycles)],
  stalled: f => ['warning', 'var(--red)', t('{0}: stalled for {1} sessions.', f.exercise, f.sessions)],
  fatigue: f => ['bolt', 'var(--orange)', t('{0}: reps dropped between sets — fatigue.', f.exercise)],
  'ready-to-progress': f => ['arrowUp', 'var(--green)', t('{0}: ready to add weight or a set.', f.exercise)],
  inactive: f => ['calendar', 'var(--orange)', t('{0} days without training.', f.days)],
  'volume-low': f => ['arrowDown', 'var(--orange)', t('{0}: {1} effective sets per microcycle, below 10.', groupName(f.group), fmtNum(f.sets))],
  'volume-high': f => ['arrowUp', 'var(--red)', t('{0}: {1} effective sets per microcycle, above 20.', groupName(f.group), fmtNum(f.sets))],
  'strength-drop': f => ['chartLine', 'var(--red)', t('{0}: estimated 1RM {1}%.', f.exercise, fmtNum(f.change_pct))],
}

const FOCUS_LABEL = { overview: 'Overview', progression: 'Progression', programming: 'Programming', volume: 'Volume' }

const nameOf = (id, entry) =>
  EXIDX[id] ? exerciseNameFor(EXIDX[id]) : (entry && (entry.muscleSnapshot?.n || entry.exercise?.n || entry.n)) || id

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch (e) { /* fall through */ }
  // Older WebViews without the async clipboard: a throwaway selected textarea.
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch (e) { /* ignore */ }
  ta.remove()
  return ok
}

async function shareText(text) {
  if (MOBILE) {
    const { Share } = await import('@capacitor/share')
    await Share.share({ title: 'HipertroFit', text })
    return
  }
  await navigator.share({ title: 'HipertroFit', text })
}

const Line = ({ icon, color, children, action }) =>
  <div className="row" style={{ gap: 10, padding: '8px 12px', flexWrap: 'nowrap', alignItems: 'flex-start' }}>
    <span style={{ color, flex: 'none' }}><Icon name={icon} /></span><span className="small" style={{ flex: 1 }}>{children}</span>
    {action}
  </div>

// What a proposal (lib/ai-actions.js) would change, spelled out for the confirmation dialog.
function ProposalText({ p }) {
  if (p.kind === 'deload') {
    return <>{t('Mark microcycle #{0} as a deload: the same sessions with about {1}% less weight, reps and sets.', p.cycle + 1, Math.round(p.pct * 100))}</>
  }
  return <div style={{ textAlign: 'left' }}>
    <div style={{ marginBottom: 8 }}>{t('{0}: planned effective sets per microcycle {1} → {2}.', groupName(p.group), fmtNum(p.before), fmtNum(p.after))}</div>
    {p.changes.map((c, i) => <div key={i} className="small">
      • <b>{c.routineName || t('Routine')}</b> · {nameOf(c.exId)}: {t('{0} → {1} sets', c.from, c.to)}
    </div>)}
    <div className="small dim" style={{ marginTop: 8 }}>{t('Only the number of sets changes. Weight, reps and progression stay as they are.')}</div>
  </div>
}

// "Apply" beside a finding or a suggestion that maps to a change the app can make. Always asks first,
// and re-checks on confirm: if the routines changed in the meantime nothing is written.
function ApplyButton({ S, item, update }) {
  const p = useMemo(() => proposalFor(S, item), [S, item])
  if (!p) return null
  if (p.missing) return <span className="small dim" style={{ flex: 'none', maxWidth: 120, textAlign: 'right' }}>{t('Needs an exercise for this group')}</span>
  const toast = m => useUI.getState().toast(m)
  return <button className="chip nocap on" style={{ flex: 'none', padding: '3px 10px', fontSize: 12 }}
    onClick={() => confirmSheet({
      title: p.kind === 'deload' ? t('Schedule a deload?') : t('Adjust the sets?'),
      message: <ProposalText p={p} />,
      confirmText: t('Apply'),
      onConfirm: () => {
        let ok = false
        update(d => { ok = applyProposal(d, p) })
        toast(ok ? t('Change applied') : t('Your plan changed in the meantime — nothing was applied.'))
      },
    })}>{t('Apply')}</button>
}

// A small line of fine print with its icon beside it, not above it.
const Note = ({ icon, color, style, children }) =>
  <div className="row small" style={{ gap: 8, marginTop: 8, flexWrap: 'nowrap', alignItems: 'flex-start', lineHeight: 1.45, color: color || 'var(--label-2)', ...style }}>
    <span style={{ flex: 'none', display: 'inline-flex' }}><Icon name={icon} /></span><span>{children}</span>
  </div>

function ReportView({ report, S, update }) {
  return <>
    {report.summary && <div className="small" style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap', margin: '4px 0 10px' }}>{report.summary}</div>}
    {report.alerts.length > 0 && <div className="list" style={{ marginBottom: 10 }}>
      {report.alerts.map((a, i) => <Line key={i} icon="warning" color="var(--orange)">
        {a.target && <b>{a.target}: </b>}{a.detail}
      </Line>)}
    </div>}
    {report.suggestions.length > 0 && <div className="list" style={{ marginBottom: 10 }}>
      {report.suggestions.map((s, i) => <Line key={i} icon="lightbulb" color="var(--green)" action={S && <ApplyButton S={S} item={s} update={update} />}>
        <b>{t(actionKey(s.action))}{s.target ? ' · ' + s.target : ''}</b><br />{s.reason}
      </Line>)}
    </div>}
    <div className="small dim">{fmtDate(report.d, true)} · {t(FOCUS_LABEL[report.focus] || 'Overview')} · {report.model}{report.host ? ' @ ' + report.host : ''}</div>
    <div className="small dim" style={{ marginTop: 4 }}>{t('AI-generated suggestions can be wrong. Nothing is changed in your routines unless you do it.')}</div>
  </>
}

function PastReports({ reports, onDelete, S, update }) {
  const [open, setOpen] = useState(null)
  if (!reports.length) return null
  return <>
    <h4 className="sec">{t('Previous analyses')}</h4>
    <div className="list" style={{ marginBottom: 14 }}>
      {reports.map(r => <div key={r.id} style={{ padding: '8px 12px' }}>
        <div className="row between" style={{ flexWrap: 'nowrap', gap: 8 }}>
          <button className="small" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left', background: 'none', border: 0, color: 'inherit', padding: 0 }}
            onClick={() => setOpen(o => (o === r.id ? null : r.id))}>
            <Icon name={open === r.id ? 'chevronUp' : 'chevronDown'} /><span>{fmtDate(r.d, true)} · {t(FOCUS_LABEL[r.focus] || 'Overview')}</span>
          </button>
          <button className="iconbtn" style={{ width: 30, height: 30, color: 'var(--red)' }} aria-label={t('Delete')} onClick={() => onDelete(r.id)}><Icon name="trash" /></button>
        </div>
        {open === r.id && <div style={{ marginTop: 8 }}><ReportView report={r} S={S} update={update} /></div>}
      </div>)}
    </div>
  </>
}

function AiAnalysisSheet() {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const update = useStore(s => s.update)
  const [focus, setFocus] = useState('overview')
  const [preview, setPreview] = useState(false)
  const [server, setServer] = useState(null)       // /api/ai/config, null until known
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [fresh, setFresh] = useState(null)         // id of the report answered in this sheet
  const [byok, setByok] = useState(() => loadByok())  // this device's own provider, or null
  const toast = m => useUI.getState().toast(m)
  const digest = useMemo(() => buildDigest(S, { nameOf }), [S])
  const prompt = useMemo(() => buildPrompt(digest, { lang: getLang(), focus }), [digest, focus])
  const canShare = MOBILE || typeof navigator.share === 'function'
  const findings = digest.findings.map(f => FINDING[f.type] && [...FINDING[f.type](f), f]).filter(Boolean)
  const reports = Array.isArray(S.aiReports) ? S.aiReports : []
  const latest = fresh && reports.find(r => r.id === fresh)

  useEffect(() => {
    if (!user) return
    let live = true
    api('/api/ai/config').then(c => { if (live) setServer(c) }).catch(() => { if (live) setServer({ enabled: false }) })
    return () => { live = false }
  }, [user])

  // Signed in, the server's answer decides first — so the own-key option does not flash up and
  // vanish while /api/ai/config is still on its way.
  const known = !user || server !== null
  const online = !!(server && server.enabled)
  const direct = known && !online && byokReady(byok)

  const analyze = async () => {
    setBusy(true); setError(null)
    try {
      const body = buildPrompt(digest, { lang: getLang(), focus, json: true })
      const res = online
        ? await api('/api/ai/analyze', { method: 'POST', body: JSON.stringify({ prompt: body }) })
        : await callProvider(byok, body)
      const report = reportOf(res, { focus, date: todayISO() })
      update(s => { s.aiReports = addReport(s.aiReports, report) })
      setFresh(report.id)
      if (online) setServer(c => ({ ...c, remaining: res.remaining }))
    } catch (e) {
      setError(t(aiErrorKey(e)))
      if (e.status === 429 && e.message === 'daily ai limit reached') setServer(c => ({ ...c, remaining: 0 }))
    } finally {
      setBusy(false)
    }
  }

  const outOfQuota = online && server.remaining === 0
  const notice = online ? providerNotice(server.host) : direct ? providerNotice(hostOf(byok.base), { direct: true }) : null
  const editProvider = () => aiProviderSheet(byok, setByok)

  return <>
    <h3>{t('Analyze with AI')}</h3>

    <h4 className="sec">{t('What the app sees')}</h4>
    {findings.length
      ? <div className="list" style={{ marginBottom: 14 }}>{findings.map(([icon, color, text, f], i) => <Line key={i} icon={icon} color={color} action={<ApplyButton S={S} item={f} update={update} />}>{text}</Line>)}</div>
      : <div className="muted small" style={{ marginBottom: 14 }}>{S.workouts.length ? t('Nothing to flag right now.') : t('Log a few workouts to get an analysis.')}</div>}

    <h4 className="sec">{t('Ask an assistant')}</h4>
    <Segmented className="seg-range" value={focus} onChange={setFocus} options={Object.entries(FOCUS_LABEL).map(([value, label]) => ({ value, label: t(label) }))} />

    {(online || direct) && <div style={{ margin: '12px 0 14px' }}>
      <Button variant="primary" icon="sparkles" disabled={busy || outOfQuota} onClick={analyze}>{busy ? t('Analyzing…') : t('Analyze now')}</Button>
      {online
        ? <Note icon="globe">
          {t('Your digest is sent to {0} ({1}) through this server. No name, account or notes.', server.host, server.model)}
          {server.remaining != null && <> {t('{0} analyses left today.', server.remaining)}</>}
        </Note>
        : <Note icon="key">
          {t('Your digest is sent from this device to {0} ({1}) with your API key. No name, account or notes.', hostOf(byok.base), byok.model)}
          {' '}<a href="#" onClick={e => { e.preventDefault(); editProvider() }}>{t('Change')}</a>
        </Note>}
      {notice && <Note icon={notice.tone === 'warn' ? 'warning' : 'shield'} color={notice.tone === 'warn' ? 'var(--orange)' : 'var(--green)'}>{t(notice.key)}</Note>}
      {error && <div className="small" style={{ marginTop: 8, color: 'var(--red)' }}>{error}</div>}
      {latest && <div className="card" style={{ marginTop: 12 }}><ReportView report={latest} S={S} update={update} /></div>}
    </div>}

    {known && !online && !direct && <div style={{ margin: '12px 0 4px' }}>
      <Button variant="primary" icon="key" onClick={editProvider}>{byok ? t('Finish setting up your AI provider') : t('Use your own API key')}</Button>
      <Note icon="info">{t('Connect a free provider (Groq, Gemini, OpenRouter, Mistral) or a local Ollama to analyze right here.')}</Note>
    </div>}

    <Note icon="lock" style={{ margin: '10px 0' }}>{online || direct
      ? t('Or copy the prompt into an assistant of your choice.')
      : t('Nothing is sent from the app. Copy the prompt and paste it into the assistant you choose (Gemini, ChatGPT, Claude…). It includes your routines, recent sessions, volume and body weight — no name, account or notes.')}
    </Note>
    <Button icon="clipboard" onClick={async () => toast(await copyText(prompt) ? t('Prompt copied') : t('Could not copy'))}>{t('Copy prompt')}</Button>
    {canShare && <><div style={{ height: 8 }} />
      <Button icon="upload" onClick={() => shareText(prompt).catch(() => { /* share sheet dismissed */ })}>{t('Share')}</Button></>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" icon={preview ? 'chevronUp' : 'chevronDown'} onClick={() => setPreview(p => !p)}>
      {preview ? t('Hide data') : t('See exactly what is shared')} · ~{fmtNum(approxTokens(prompt))} tokens
    </Button>
    {preview && <pre className="small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 280, overflow: 'auto', background: 'var(--surface-2)', padding: 10, borderRadius: 10, margin: '8px 0 14px' }}>{prompt}</pre>}

    <div style={{ height: 8 }} />
    <PastReports S={S} update={update} reports={reports.filter(r => r.id !== fresh)} onDelete={id => update(s => { s.aiReports = removeReport(s.aiReports, id) })} />
  </>
}

export const aiAnalysisSheet = () => useUI.getState().openSheet(close => <AiAnalysisSheet close={close} />)
