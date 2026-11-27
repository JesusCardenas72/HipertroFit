/* HipertroFit's corrections over openGym 1.4.5 (informe de implementación, sección 7).
 *
 * Each of these was a place where the prompt asked for caution and the code did not enforce it.
 * The validator, not the prompt, is the security boundary, so each rule lives there and is pinned
 * here: C1 pain is prudence, C2 adapt names only what it was offered, C3 adapt never invents a load,
 * C4 adapt checks equipment against the list it was offered from, C5 a review longer than a person
 * can weigh goes back for repair, C6 one session is not a trend. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const payloadLib = await import('../coach/core/payload.js');
const { runPipeline } = await import('../coach/core/pipeline.js');
const { validateAdapt, validateReview, MAX_REVIEW_CHANGES } = await import('../coach/core/validate.js');
const { LIBRARY } = await import('../coach/core/library.js');

const NOW = Date.parse('2026-10-29T12:00:00Z');
const day = n => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
const set = (w, r, done = true, extra = {}) => ({ w, r, done, ...extra });
const H = 'h'.repeat(16);

// 0025 barbell bench press, 0294 dumbbell biceps curl, 0043 barbell full squat.
const today = {
  name: 'Push', minutes: 15, entries: [
    { id: '0025', target: { sets: 3, reps: 5, weight: 80 }, sets: [set(80, 5), set(80, 5, false), set(80, 5, false)] },
    { id: '0294', target: { sets: 3, reps: 10, weight: 14 }, sets: [set(14, 10, false), set(14, 10, false), set(14, 10, false)] }
  ]
};
const baseState = (over = {}) => ({
  unit: 'kg', lang: 'en',
  routines: [{ id: 'push', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 80 }, { id: '0294', sets: 3, reps: 10, weight: 14 }] }],
  week: { 1: ['push'] },
  workouts: [
    { id: 'w1', d: day(3), name: 'Push', entries: [{ id: '0025', sets: [set(80, 5), set(80, 5), set(80, 5)] }, { id: '0294', sets: [set(14, 10), set(14, 10)] }] }
  ],
  coach: { consent: { agreedAt: 1 } },
  ...over
});
const adaptPayload = (reason = 'busy', S = baseState()) =>
  payloadLib.build(S, { handle: H, kind: 'adapt', now: NOW, today, focus: { entry: 0, reason } });
const ctxOf = p => ({
  offered: new Set(p.library.map(e => e.id)),
  reason: p.focus?.reason,
  workingWeights: p.history?.workingWeights
});
const answer = changes => ({ coach_contract: 1, summary: 'Adjusting today.', changes });
const stub = answers => {
  const calls = [];
  return { calls, adapter: { spawns: false, async invoke(req) { calls.push(req); return { code: 0, text: JSON.stringify(answers.shift()) }; } } };
};

/* ---------- C1: pain ---------- */
test('C1: with pain, the validator refuses anything that makes the session harder', () => {
  const p = adaptPayload('pain');
  const ctx = ctxOf(p);
  const notOffered = p.library.find(e => !today.entries.some(x => x.id === e.id)).id;
  const refused = [
    { type: 'weight', entry: 0, pct: 10, why: 'feels fine' },
    { type: 'sets', entry: 0, sets: 4, why: 'more volume' },
    { type: 'reps', entry: 0, reps: 8, why: 'more reps' },
    { type: 'add', to: notOffered, sets: 2, reps: 10, why: 'extra work' }
  ];
  for (const c of refused) {
    const r = validateAdapt(answer([c]), p.today, ctx);
    assert.equal(r.ok, false, JSON.stringify(c));
    assert.match(r.errors.join(' '), /pain/);
  }
  // Lighter, fewer, or a different exercise is exactly what pain calls for.
  for (const c of [
    { type: 'weight', entry: 0, pct: -20, why: 'lighter' },
    { type: 'sets', entry: 0, sets: 1, why: 'fewer' },
    { type: 'reps', entry: 0, reps: 3, why: 'fewer reps' },
    { type: 'skip', entry: 0, why: 'stop' }
  ]) assert.equal(validateAdapt(answer([c]), p.today, ctx).ok, true, JSON.stringify(c));
  // Without pain the same +10 % is allowed.
  assert.equal(validateAdapt(answer([refused[0]]), p.today, ctxOf(adaptPayload('great'))).ok, true);
});

test('C1: the pipeline hands the focus reason to the validator', async () => {
  const { adapter, calls } = stub([
    answer([{ type: 'weight', entry: 0, pct: 10, why: 'push through' }]),
    answer([{ type: 'weight', entry: 0, pct: -20, why: 'lighter while it hurts' }])
  ]);
  const r = await runPipeline({ adapter, cfg: {}, kind: 'adapt', payload: adaptPayload('pain') });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2, 'the +10 % went back for repair');
  assert.match(calls[1].prompt, /pain/);
  assert.equal(r.result.changes[0].pct, -20);
});

/* ---------- C2: only what was offered ---------- */
test('C2: swap and add name only exercises from the library the payload offered', () => {
  const p = adaptPayload();
  const ctx = ctxOf(p);
  const outside = LIBRARY.find(e => !ctx.offered.has(e.id) && e.eq === 'barbell').id;
  for (const c of [
    { type: 'swap', entry: 0, to: outside, why: 'x' },
    { type: 'add', to: outside, sets: 2, reps: 10, why: 'x' }
  ]) {
    const r = validateAdapt(answer([c]), p.today, ctx);
    assert.equal(r.ok, false, JSON.stringify(c));
    assert.match(r.errors.join(' '), /library provided/);
  }
});

/* ---------- C3: no invented loads ---------- */
test('C3: a swap or add load is capped at the best recorded and dropped without history', () => {
  const S = baseState({
    workouts: [...baseState().workouts, { id: 'w0', d: day(9), name: 'Arms', entries: [{ id: '0285', sets: [set(30, 8), set(32, 6)] }] }]
  });
  const p = adaptPayload('busy', S);
  assert.ok(p.history?.workingWeights?.some(w => w.id === '0025' && w.best === 80), JSON.stringify(p.history));
  const ctx = ctxOf(p);
  const fresh = p.library.find(e => !today.entries.some(x => x.id === e.id) && !(p.history.workingWeights || []).some(w => w.id === e.id)).id;
  // A known exercise: capped at its best.
  const trained = p.library.find(e => e.id === '0285');
  if (trained) {
    const r = validateAdapt(answer([{ type: 'swap', entry: 0, to: '0285', weight: 500, why: 'x' }]), p.today, ctx);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.proposal.changes[0].weight, 32);
  }
  // Never lifted: no number at all, the first set sets the baseline.
  const r = validateAdapt(answer([{ type: 'add', to: fresh, sets: 2, reps: 10, weight: 60, why: 'x' }]), p.today, ctx);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.proposal.changes[0].weight, undefined);
  const s = validateAdapt(answer([{ type: 'swap', entry: 0, to: fresh, weight: 900, why: 'x' }]), p.today, ctx);
  assert.equal(s.proposal.changes[0].weight, undefined);
});

/* ---------- C4: one equipment list ---------- */
test('C4: without a Coach profile, adapt validates against the gym equipment it was offered from', async () => {
  const S = baseState({
    equipFilterOn: true, activeEquipId: 'g1',
    equipProfiles: [{ id: 'g1', name: 'Home', equipment: ['dumbbell', 'body weight'] }]
  });
  const p = adaptPayload('busy', S);
  assert.equal(p.coachProfile ?? null, null);
  assert.deepEqual(payloadLib.adaptEquipment(p), ['dumbbell', 'body weight']);
  // A barbell lift: no barbell at home. The equipment rule alone turns it away...
  const barbell = LIBRARY.find(e => e.eq === 'barbell' && !today.entries.some(x => x.id === e.id)).id;
  const alone = validateAdapt(answer([{ type: 'swap', entry: 0, to: barbell, why: 'x' }]), p.today, { equipment: payloadLib.adaptEquipment(p) });
  assert.equal(alone.ok, false);
  assert.match(alone.errors.join(' '), /equipment/);
  // ...and the pipeline sends it back for repair.
  const { adapter, calls } = stub([
    answer([{ type: 'swap', entry: 0, to: barbell, why: 'x' }]),
    { coach_contract: 1, nochange: true, reading: 'Carry on.' }
  ]);
  const r = await runPipeline({ adapter, cfg: {}, kind: 'adapt', payload: p });
  assert.equal(calls.length, 2, 'the barbell swap went back for repair');
  assert.equal(r.nochange, true);
});

/* ---------- C5: a reviewable number of changes ---------- */
const bigState = () => {
  const ids = LIBRARY.filter(e => e.eq === 'dumbbell').slice(0, 12).map(e => e.id);
  return baseState({ routines: [{ id: 'big', name: 'Big day', ex: ids.map(id => ({ id, sets: 3, reps: 10 })) }], week: { 1: ['big'] } });
};
const setsChanges = (S, n) => S.routines[0].ex.slice(0, n).map((e, i) => ({ id: 'c' + i, type: 'sets', target: { routineId: 'big', exId: e.id }, after: 4, why: 'More volume here.' }));

test('C5: a review with more than ten changes is refused, ten is fine', () => {
  assert.equal(MAX_REVIEW_CHANGES, 10);
  const S = bigState();
  const plan = payloadLib.cleanPlan(S);
  const eleven = validateReview({ coach_contract: 1, summary: 's', changes: setsChanges(S, 11) }, plan, {});
  assert.equal(eleven.ok, false);
  assert.match(eleven.errors.join(' '), /at most 10/);
  const ten = validateReview({ coach_contract: 1, summary: 's', changes: setsChanges(S, 10) }, plan, {});
  assert.equal(ten.ok, true, JSON.stringify(ten.errors));
  assert.equal(ten.proposal.changes.length, 10);
});

test('C5: eleven changes trigger the repair round', async () => {
  const S = bigState();
  const workouts = Array.from({ length: 4 }, (_, i) => ({ id: 'w' + i, d: day(10 - i * 2), name: 'Big day', entries: [{ id: S.routines[0].ex[0].id, sets: [set(10, 10), set(10, 10), set(10, 10)] }] }));
  const p = payloadLib.build({ ...S, workouts }, { handle: H, kind: 'review', now: NOW });
  const { adapter, calls } = stub([
    { coach_contract: 1, summary: 's', evidence: 'e', changes: setsChanges(S, 11) },
    { coach_contract: 1, summary: 's', evidence: 'e', changes: setsChanges(S, 3) }
  ]);
  const r = await runPipeline({ adapter, cfg: {}, kind: 'review', payload: p });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(calls.length, 2);
  assert.equal(r.result.changes.length, 3);
});

/* ---------- C6: one session is not a trend ---------- */
test('C6: with fewer than two sessions and no request, a review can only say "no changes"', async () => {
  const S = bigState();
  const one = [{ id: 'w1', d: day(2), name: 'Big day', entries: [{ id: S.routines[0].ex[0].id, sets: [set(10, 10), set(10, 10), set(10, 6)] }] }];
  const p = payloadLib.build({ ...S, workouts: one }, { handle: H, kind: 'review', now: NOW });
  assert.equal(p.window.workouts.length, 1);
  const { adapter, calls } = stub([
    { coach_contract: 1, summary: 's', evidence: 'e', changes: setsChanges(S, 1) },
    { coach_contract: 1, summary: 's', evidence: 'e', changes: setsChanges(S, 1) }
  ]);
  const r = await runPipeline({ adapter, cfg: {}, kind: 'review', payload: p });
  assert.equal(r.ok, false, 'changes on one session are refused, repair included');
  assert.equal(calls.length, 2);
  assert.match(r.errors.join(' '), /nochange/);

  // The same session with the athlete asking for something is a request, not a trend.
  const asked = payloadLib.build({ ...S, workouts: one }, { handle: H, kind: 'review', now: NOW, note: 'Add a set to the first exercise' });
  const s2 = stub([{ coach_contract: 1, summary: 's', evidence: 'e', changes: setsChanges(S, 1) }]);
  const r2 = await runPipeline({ adapter: s2.adapter, cfg: {}, kind: 'review', payload: asked });
  assert.equal(r2.ok, true, JSON.stringify(r2.errors));

  // And "no changes" is always an answer.
  const s3 = stub([{ coach_contract: 1, nochange: true, reading: 'One session, nothing to read yet.' }]);
  assert.equal((await runPipeline({ adapter: s3.adapter, cfg: {}, kind: 'review', payload: p })).nochange, true);
});
