// Feature switches (a reduced port of openGym 1.4.5 lib/modules.js, which the AI Coach reads).
// HipertroFit has one switchable module so far: the AI Coach. S.modules is { [id]: boolean } and
// holds only the choices someone made; a missing key is on. Pure: no imports.
let unavailable = new Set()

/** Whether module `id` is switched on for this profile (and offered by this build). */
export const isOn = (S, id) => !unavailable.has(id) && !(S && S.modules && S.modules[id] === false)

/** Modules this build cannot offer at all (build-caps.js). */
export function setUnavailableModules(ids) { unavailable = new Set(ids || []) }
