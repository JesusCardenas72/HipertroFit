// The app version, tiny, in the top-right corner of every screen — so a screenshot of any
// screen already says which build it came from. See .ver-badge in index.css for why it fits
// without touching anything.
export default function VersionBadge() {
  return <div className="ver-badge" aria-hidden="true">v{__APP_VERSION__}</div>
}
