import mark from '../assets/brand/logo.svg'

// The HipertroFit mark, as drawn on the launch screen and the home-screen icon: no background,
// so it sits on whatever the theme puts behind it. The caller sets its size; in the header it is
// set in the same units as the text beside it, so Settings ▸ Appearance scales them together.
export default function BrandMark({ className, style }) {
  return <img className={className} style={style} src={mark} alt="" draggable={false} />
}
