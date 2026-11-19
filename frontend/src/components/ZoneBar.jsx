import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { volumeBlocks } from '../lib/volume.js'

// One muscle group's volume bar, the same everywhere the app shows a group's volume (Home, Progress,
// the Programming sheet, the free workout, a routine outside the sequence): a bullet chart whose
// track is cut into the zones of the band (under the minimum, inside it, past the optimal maximum),
// each zone a continuous tinted band, and the sets as blocks laid over it (lib/volume.js
// volumeBlocks) — filled with the sets done (`done`, in `color`), striped with those planned
// (`planned`, the running total including what is done; red with `over`) and, with `after`, in blue
// with what the session being planned adds on top. The blocks are grouped by zone so each band runs
// exactly under its own sets.
export default function ZoneBar({ done = 0, planned = 0, after = 0, band, color, over }) {
  const zones = []
  volumeBlocks(done, planned, band, { after }).forEach(b => {
    if (!zones.length || b.edge) zones.push({ zone: b.zone, blocks: [] })
    zones[zones.length - 1].blocks.push(b)
  })
  return <span className="zbar" role="img" aria-label={t('{0} of {1}–{2} sets', fmtNum(after || done), band.min, band.max)}>
    {zones.map((z, j) => <span key={j} className={'zone ' + z.zone} style={{ flexGrow: z.blocks.length }}>
      {z.blocks.map((b, k) => <span key={k} className="zb">
        {b.add > Math.max(b.plan, b.fill) && <i className="add" style={{ width: b.add * 100 + '%' }} />}
        {b.plan > b.fill && <i className={'plan' + (over ? ' over' : '')} style={{ width: b.plan * 100 + '%' }} />}
        {b.fill > 0 && <i style={{ width: b.fill * 100 + '%', background: color }} />}
      </span>)}
    </span>)}
  </span>
}
