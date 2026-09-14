import { useState } from 'react'
import { imgSrc, gifSrc } from '../lib/exercises.js'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Big autoplaying animation; tap toggles to the still frame. `compact` shrinks it (superset cards).
// A custom exercise shows the picture you gave it: a still image only (no play toggle), or an
// animated GIF with its first frame as the still. Without one, nothing renders.
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12). Settings can also turn workout media off entirely
// (gifSize 'off') — then nothing renders here and the exercise card closes up, exactly like
// a custom exercise without media. Any other/legacy value behaves as 'full'.
export default function Media({ ex, id, compact, minimizable }) {
  const [playing, setPlaying] = useState(true)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  if (!ex.gif && !ex.img) return null
  const animated = !!ex.gif
  if (minimizable && gifSize === 'off') return null
  const mini = minimizable && gifSize === 'mini'
  // The workout toggle steps through the same three sizes the Settings selector offers —
  // full → mini → off (hidden) → full — one press at a time. When off, this renders nothing
  // and the way back is the "Expand" chip beside the exercise number (see Workout.jsx).
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'off' : 'mini' }) }
  return (
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '')} id={id} onClick={() => animated && setPlaying(p => !p)}>
      <img decoding="async" draggable={false} src={animated && playing ? gifSrc(ex) : imgSrc(ex)} alt={exerciseNameFor(ex)} />
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'eyeSlash' : 'minimize'} />{mini ? t('Hide') : t('Minimize')}
        </button>
      )}
      {!mini && animated && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
  )
}

export function Thumb({ ex }) {
  if (!ex.img) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  return <img className="thumb" loading="lazy" decoding="async" draggable={false} src={imgSrc(ex)} alt="" />
}
