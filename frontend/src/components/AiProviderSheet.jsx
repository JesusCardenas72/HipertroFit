import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { Button, Switch, TextField } from './ui.jsx'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { PROVIDERS, providerById, normalizeByok, baseUrlError, byokReady, saveByok, clearByok } from '../lib/ai-provider.js'

// Provider settings for the bring-your-own-key AI analysis (lib/ai-provider.js). Picking a preset
// fills in the URL and a model; everything stays editable. The key field behaves like the Hevy
// import's: a password field, wiped from memory when the sheet closes.

function AiProviderSheet({ initial, onSaved, close }) {
  const [cfg, setCfg] = useState(() => normalizeByok(initial || { provider: 'groq', ...PROVIDERS[0] }))
  useEffect(() => () => setCfg(c => ({ ...c, key: '' })), [])
  const preset = providerById(cfg.provider)
  const set = patch => setCfg(c => ({ ...c, ...patch }))
  const pick = p => set({ provider: p.id, base: p.base, model: p.model })
  const urlError = cfg.base ? baseUrlError(cfg.base) : null
  const field = { autoComplete: 'off', spellCheck: false, autoCapitalize: 'off' }
  const label = text => <label className="small dim" style={{ display: 'block', margin: '12px 0 6px' }}>{text}</label>

  return <>
    <h3>{t('Your AI provider')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      {t('The analysis is sent straight from this device to the provider you choose, with your own API key. Groq, Gemini, OpenRouter and Mistral have free tiers.')}
    </div>

    {label(t('Provider'))}
    <div className="chips">
      {PROVIDERS.map(p => <button key={p.id} className={'chip nocap' + (cfg.provider === p.id ? ' on' : '')} onClick={() => pick(p)}>{p.id === 'custom' ? t('Custom') : p.name}</button>)}
    </div>

    {label(t('API URL'))}
    <TextField {...field} inputMode="url" placeholder="https://…/v1" value={cfg.base} onChange={e => set({ base: e.target.value })} />
    {urlError && <div className="small" style={{ color: 'var(--red)', marginTop: 6 }}>{t(urlError)}</div>}

    {label(t('Model'))}
    <TextField {...field} placeholder={preset.modelHint || 'model-id'} value={cfg.model} onChange={e => set({ model: e.target.value })} />

    {!preset.noKey && <>
      {label(t('API key'))}
      <TextField {...field} type="password" placeholder={cfg.provider === 'custom' ? t('Optional') : ''} value={cfg.key} onChange={e => set({ key: e.target.value })} />
      {preset.keyUrl && <div className="small" style={{ marginTop: 8 }}>
        <a href={preset.keyUrl} target="_blank" rel="noopener noreferrer">{t('Get a free API key')}</a>
        <span className="dim"> — {new URL(preset.keyUrl).host}</span>
      </div>}
    </>}
    {preset.id === 'ollama' && <div className="small dim" style={{ marginTop: 8, lineHeight: 1.45 }}>
      {t('Ollama must run on this device and allow the app: start it with OLLAMA_ORIGINS set to this page\'s address.')}
    </div>}

    <div className="row between" style={{ marginTop: 16, flexWrap: 'nowrap', gap: 12 }}>
      <div><div>{t('Remember the key on this device')}</div>
        <div className="small dim" style={{ lineHeight: 1.4 }}>{t('Off: you paste it again after reopening the app. The key is never synced or included in backups.')}</div></div>
      <Switch checked={cfg.remember} onChange={v => set({ remember: v })} />
    </div>
    <div className="row between" style={{ marginTop: 12, flexWrap: 'nowrap', gap: 12 }}>
      <div><div>{t('Ask for structured answers')}</div>
        <div className="small dim" style={{ lineHeight: 1.4 }}>{t('Turn off if the model rejects JSON mode.')}</div></div>
      <Switch checked={cfg.jsonMode} onChange={v => set({ jsonMode: v })} />
    </div>

    <div style={{ height: 16 }} />
    {/* What is in the key field now is the user's decision: `keyed` follows it, not the old config. */}
    <Button variant="primary" icon="check" disabled={!byokReady({ ...cfg, keyed: false })} onClick={() => { onSaved(saveByok({ ...cfg, keyed: false })); close() }}>{t('Save')}</Button>
    {initial && <><div style={{ height: 8 }} />
      <Button variant="danger" icon="trash" onClick={() => { clearByok(); onSaved(null); close(); useUI.getState().toast(t('AI provider removed')) }}>{t('Remove provider and key')}</Button></>}
    <div className="row small dim" style={{ marginTop: 12, lineHeight: 1.45, gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
      <span style={{ flex: 'none', display: 'inline-flex' }}><Icon name="info" /></span>
      <span>{t('Free tiers have daily limits and their own privacy terms — check them with the provider.')}</span>
    </div>
  </>
}

export const aiProviderSheet = (initial, onSaved) =>
  useUI.getState().openSheet(close => <AiProviderSheet initial={initial} onSaved={onSaved} close={close} />)
