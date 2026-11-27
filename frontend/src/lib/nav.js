// Lets non-component modules (sheet flows) navigate. App registers the router's navigate.
let _nav = () => {}
export const setNav = fn => { _nav = fn }
export const nav = to => _nav(to)

// Close a sheet, then go somewhere (the AI Coach's cards; openGym lib/nav.js closeThenNav).
export function closeThenNav(close, to) {
  if (close) close()
  nav(to)
}
