/* A fetch for the server that waits as long as a job may.
 *
 * openGym builds this on the `undici` package so it can lift Node's 300-second headers timeout
 * for slow local models. HipertroFit keeps the API at two dependencies (CONTRIBUTING.md), so it
 * uses Node's global fetch as is: the job's own timeout still applies through the AbortSignal the
 * adapters pass, and the HTTP adapters stream their answers, so the headers arrive early and the
 * 300-second limit is only reached by a provider that sits silent for five minutes before its
 * first byte. If a non-streaming local model ever needs longer, this is the one file to change.
 *
 * Node-only by design: the phone's transport is capacitor-fetch.js, and the core adapters
 * take whichever fetch they are given. */

/** fetch(url, init) for a job of `timeoutMs`; the AbortController the caller holds still wins. */
export function fetchFor(timeoutMs) { // eslint-disable-line no-unused-vars
  return (url, init = {}) => globalThis.fetch(url, init);
}
