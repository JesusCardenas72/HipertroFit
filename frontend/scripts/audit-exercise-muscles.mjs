// Regenerates src/lib/exercise-muscles.json — the reviewed primary/secondary muscles of every
// built-in exercise.
//
//   node scripts/audit-exercise-muscles.mjs           write the JSON
//   node scripts/audit-exercise-muscles.mjs --report  also print id|name|rule|primaries|secondaries
//
// The upstream dataset names a target muscle and a free-text secondary list that is often
// wrong for the movement (calf raises "working" the hamstrings, wrist curls the biceps,
// triceps extensions the shoulders, bench presses the biceps). Every exercise is matched to a
// movement family below, most specific first; the family decides its muscles. IDS fixes the
// exercises a name pattern cannot read correctly.
//
// What counts as a secondary: a synergist that does real, trainable work through the range
// (the triceps in a bench press, the biceps in a row). Stabilisers that only hold position —
// the abs in a push-up, the calves in a squat, the forearms in a pushdown — are left out:
// every secondary adds fractional volume (lib/volume.js), so a stabiliser listed everywhere
// inflates its group with sets that never trained it.
//
// Vocabulary: the canonical slugs of lib/muscles.js MUSCLES, plus 'lats' and 'rear-delts',
// which the muscle map folds into upper-back / deltoids and the volume split keeps apart.

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EXDB } from '../src/lib/exercises-data.js'

// lib/muscles.js MUSCLES (not imported: it pulls in the catalogue this script writes).
// exercise-muscles.test.js checks the output against the real list.
const MUSCLES = [
  'trapezius', 'deltoids', 'chest', 'upper-back', 'serratus', 'biceps', 'triceps', 'forearm',
  'abs', 'obliques', 'lower-back', 'gluteal', 'quadriceps', 'hamstring', 'adductors', 'hip-flexors',
  'calves', 'tibialis',
]

const OUT = fileURLToPath(new URL('../src/lib/exercise-muscles.json', import.meta.url))

// Family -> [primaries, secondaries]. Tested in order against the lower-cased name (and, where
// the name is ambiguous, the dataset target `tg`, equipment `eq` or body part `bp`).
const has = (n, re) => re.test(n)

function family(e) {
  const n = e.n.toLowerCase()
  const tg = e.tg
  const eq = e.eq
  const R = (rule, p, s = []) => ({ rule, p, s })

  if (tg === 'cardiovascular system') return null // cardio logs time; left as the dataset has it

  // ---- stretches & mobility: the stretched muscle, nothing assisting
  if (has(n, /\bstretch|yoga pose|\bpose\b|circles? knee|ankle circles|neck side|rotation of neck|side push neck|chin tuck|wrist circles|finger stretch|piriformis|^(?:hug|kneeling) (?:knees?|hip)/) && !has(n, /band .*stretch.* (?:curl|row|press)/))
    return R('stretch', stretchTarget(e, n))

  // ---- neck
  if (tg === 'levator scapulae' || has(n, /neck (?:flexion|extension|side|rotation)|side push neck|head (?:raise|lift)/)) return R('neck', ['trapezius'])

  // ---- olympic / full-body power
  if (has(n, /thruster|squat (?:to |and )?(?:overhead )?press|wall ball/)) return R('thruster', ['quadriceps', 'gluteal', 'deltoids'], ['triceps', 'trapezius'])
  if (has(n, /snatch/)) return R('snatch', ['gluteal', 'hamstring', 'quadriceps', 'deltoids', 'trapezius'], ['lower-back', 'triceps'])
  if (has(n, /clean and (?:press|jerk)|clean (?:to|&) press|power clean.*press/)) return R('clean & press', ['gluteal', 'hamstring', 'quadriceps', 'deltoids', 'trapezius'], ['triceps', 'lower-back'])
  if (has(n, /\bclean\b|\bhigh pull\b/) && !has(n, /clean[- ]grip/)) return R('clean', ['gluteal', 'hamstring', 'quadriceps', 'trapezius'], ['lower-back', 'deltoids', 'calves'])
  if (has(n, /swing/) && (eq === 'kettlebell' || eq === 'dumbbell')) return R('swing', ['gluteal', 'hamstring'], ['lower-back', 'deltoids'])
  if (has(n, /farmer|suitcase carry|carry\b|walk\b.*(?:dumbbell|kettlebell)/) && !has(n, /lunge/)) return R('carry', ['forearm', 'trapezius'], ['obliques', 'abs'])
  if (has(n, /turkish get.?up/)) return R('get-up', ['deltoids', 'abs', 'obliques'], ['gluteal', 'triceps'])

  // ---- calves & shins
  // The catalogue's "reverse calf raise" and "toe raise" are heel raises by their own steps (up
  // onto the balls of the feet), so they stay calf work; a real tibialis raise names itself.
  if (has(n, /tibialis raise|dorsiflex/)) return R('tibialis raise', ['tibialis'])
  if (tg === 'calves' && has(n, /calf|calves|heel raise|tiptoe|toe press|ankle|jump rope|hop/)) return R('calf raise', ['calves'])

  // ---- forearms / wrists
  if (has(n, /wrist|finger curl|pronation|supination|wrist roller|grip|gripper|hand (?:grip|squeeze)|rotate\b|forearm/) && !has(n, /curl to|press/) && (tg === 'forearms' || has(n, /wrist curl/)))
    return R('wrist', ['forearm'])

  // ---- abs & core
  if (tg === 'abs' || tg === 'spine' && has(n, /crunch|twist/)) return absFamily(n, e)

  // ---- traps
  if (has(n, /shrug/)) return R('shrug', ['trapezius'], ['forearm'])
  if (has(n, /upright row/)) return R('upright row', ['deltoids', 'trapezius'], ['biceps'])

  // ---- rear delts / face pulls / reverse flys
  if (has(n, /face pull/)) return R('face pull', ['rear-delts'], ['trapezius', 'upper-back'])
  if (has(n, /rear delt|rear lateral|reverse fly|revers fly|rear fly|reverse flye|deltoid rear|rear deltoid|t-raise|bent[- ]over lateral|lateral bent-over|bent arm lateral|seated rear|incline rear|y-raise|y raise|prone .*raise/) && !has(n, /leg raise/))
    return has(n, /row/)
      ? R('rear-delt row', ['rear-delts', 'upper-back'], ['trapezius', 'biceps'])
      : R('rear-delt raise', ['rear-delts'], ['trapezius', 'upper-back'])

  // ---- shoulder rotation (rotator cuff, drawn as the deltoids)
  if (has(n, /external rotation|internal rotation|shoulder rotation|cuban/) && !has(n, /\bhip\b/)) return has(n, /cuban/)
    ? R('cuban press', ['deltoids', 'rear-delts'], ['trapezius'])
    : R('rotator cuff', ['deltoids'])

  // ---- lateral / front raises
  if (has(n, /lateral raise|side raise|lateral to front|full can|lateral raise|^.*\braise\b.*lateral|iron cross|scaption|l-raise|w-raise|lu raise/) && tg === 'delts')
    return R('lateral raise', ['deltoids'], ['trapezius'])
  if (has(n, /front raise|forward raise|front shoulder raise|front plate raise|plate front|raise over head|front lateral raise/) && tg === 'delts')
    return R('front raise', ['deltoids'], ['chest'])

  // ---- serratus
  if (tg === 'serratus anterior') return R('serratus', ['serratus'], ['chest', 'deltoids'])

  // ---- triceps
  if (tg === 'triceps') return tricepsFamily(n, e)

  // ---- biceps
  if (tg === 'biceps') return bicepsFamily(n, e)

  // ---- chest
  if (tg === 'pectorals') return chestFamily(n, e)

  // ---- overhead press & other delt work
  if (tg === 'delts') return deltFamily(n, e)

  // ---- back
  if (tg === 'lats' || tg === 'upper back' || tg === 'traps') return backFamily(n, e)
  if (tg === 'spine') return R('back extension', ['lower-back'], ['gluteal', 'hamstring'])

  // ---- lower body
  if (['glutes', 'quads', 'hamstrings', 'adductors', 'abductors'].includes(tg)) return legFamily(n, e)

  return R('target', [tg])
}

function stretchTarget(e, n) {
  const map = {
    pectorals: 'chest', lats: 'lats', 'upper back': 'upper-back', delts: 'deltoids', traps: 'trapezius',
    biceps: 'biceps', triceps: 'triceps', forearms: 'forearm', abs: 'abs', spine: 'lower-back',
    glutes: 'gluteal', quads: 'quadriceps', hamstrings: 'hamstring', adductors: 'adductors',
    abductors: 'gluteal', calves: 'calves', 'levator scapulae': 'trapezius', 'serratus anterior': 'serratus',
  }
  // The dataset files some stretches under a neighbouring target; the name says what stretches.
  if (has(n, /quad|rectus femoris|hip flexor|psoas|lunge stretch/)) return has(n, /hip flexor|psoas|rectus femoris|lunge/) ? ['hip-flexors', 'quadriceps'] : ['quadriceps']
  if (has(n, /hamstring/)) return ['hamstring']
  if (has(n, /calf|calves|achilles|soleus/)) return ['calves']
  if (has(n, /glute|piriformis|figure.?four/)) return ['gluteal']
  if (has(n, /adductor|groin|butterfly|inner thigh|straddle/)) return ['adductors']
  if (has(n, /pec|chest/)) return ['chest']
  if (has(n, /lat\b|lats|latissimus/)) return ['lats']
  if (has(n, /tricep/)) return ['triceps']
  if (has(n, /bicep/)) return ['biceps']
  if (has(n, /shoulder|delt/)) return ['deltoids']
  if (has(n, /neck|trap/)) return ['trapezius']
  if (has(n, /wrist|finger|forearm/)) return ['forearm']
  if (has(n, /lower back|spine|cat|cobra|child/)) return ['lower-back']
  if (has(n, /abdominal|abs\b|side bend|oblique/)) return ['abs']
  return [map[e.tg] || 'abs']
}

function absFamily(n) {
  const R = (rule, p, s = []) => ({ rule, p, s })
  if (has(n, /side plank|side bridge/)) return R('side plank', ['obliques'], ['abs'])
  if (has(n, /plank|hollow|bird dog|dead bug|stir the pot|body saw|bear crawl hold/)) return R('plank', ['abs'], ['obliques'])
  if (has(n, /roll.?out|rollerout|fallout|wheel|ab roller|walkout|jack.?knife on ball|pike on ball|stability ball pike/)) return R('rollout', ['abs'], ['lats', 'obliques'])
  if (has(n, /pallof|anti.?rotation/)) return R('anti-rotation', ['obliques', 'abs'])
  if (has(n, /twist|russian|side bend|side bent|side crunch|oblique|woodchop|wood chop|chop\b|judo flip|standing lift|windshield|heel touch|bicycle|cross body|crossbody|elbow to knee|elbow-to-knee|alternate.*crunch|twisting|rotation|side jackknife|side-to-side|toe touch.*side|saxon|lateral/))
    return has(n, /bicycle|cross body|crossbody|elbow to knee|elbow-to-knee|twisting crunch|twisting sit|air bike/)
      ? R('twisting crunch', ['abs', 'obliques'], ['hip-flexors'])
      : R('oblique', ['obliques'], ['abs'])
  if (has(n, /air bike/)) return R('twisting crunch', ['abs', 'obliques'], ['hip-flexors'])
  if (has(n, /leg raise|knee raise|knee up|knee tuck|tuck|leg lift|leg pull|v-up|v up|jack ?knife|scissor|flutter|toes to bar|toe to bar|hanging|leg hip raise|hip raise|butt-up|bottoms-up|reverse crunch|mountain climber|lying leg|captains|captain|frog|bridge|gorilla|knee to chest|seated leg|pull-in|wind sprints/))
    return R('leg raise', ['abs', 'hip-flexors'], ['obliques'])
  if (has(n, /sit-up|sit up|situp|janda|cocoons|v-sit|v sit|curl-up(?! crunch)|toe touch|touchers|full sit/)) return R('sit-up', ['abs'], ['hip-flexors', 'obliques'])
  if (has(n, /crunch|curl.?up|ab (?:crunch|curl)|abdominal|press sit/)) return R('crunch', ['abs'], ['obliques'])
  return R('abs', ['abs'], ['obliques'])
}

function tricepsFamily(n, e) {
  const R = (rule, p, s = []) => ({ rule, p, s })
  if (has(n, /handstand/)) return R('handstand push-up', ['deltoids'], ['triceps', 'trapezius'])
  if (has(n, /\bdips?\b|body-up|bench dip|dip on floor/)) return R('triceps dip', ['triceps'], ['chest', 'deltoids'])
  if (has(n, /push.?up|push up|plank to push/)) return R('close push-up', ['triceps'], ['chest', 'deltoids'])
  if (has(n, /bench press|close.?grip press|close grip press|floor press|jm |pin press|board press|press$|hammer press|palms in|neutral grip bench|reverse grip press|elbow press|guillotine|tate press|reverse.*bench/) && !has(n, /extension|skull|french/))
    return has(n, /tate press|elbow press/)
      ? R('triceps extension', ['triceps'])
      : R('close-grip press', ['triceps'], ['chest', 'deltoids'])
  return R('triceps extension', ['triceps'])
}

function bicepsFamily(n, e) {
  const R = (rule, p, s = []) => ({ rule, p, s })
  if (has(n, /pull.?up|chin.?up|muscle.?up/)) return R('chin-up', ['lats', 'biceps'], ['upper-back', 'forearm'])
  if (has(n, /to (?:shoulder |overhead )?press|curl and press|curl to press/)) return R('curl & press', ['biceps', 'deltoids'], ['triceps', 'forearm'])
  if (has(n, /reverse|revers |pronated|zottman/) && !has(n, /reverse lunge/)) return R('reverse curl', ['biceps', 'forearm'])
  if (has(n, /hammer|neutral|rope/)) return R('hammer curl', ['biceps', 'forearm'])
  if (has(n, /lunge|\bsquat\b/) && has(n, /curl/)) return R('curl + legs', ['biceps'], ['quadriceps', 'gluteal'])
  return R('curl', ['biceps'], ['forearm'])
}

function chestFamily(n, e) {
  const R = (rule, p, s = []) => ({ rule, p, s })
  if (has(n, /pullover|pull-over/)) return R('pullover (chest)', ['chest'], ['lats', 'triceps', 'serratus'])
  if (has(n, /\bfly|flye|flyes|crossover|cross-over|cross over|pec deck|butterfly|breeding|iron cross|squeeze|svend|plate press|hug/) && !has(n, /press$|bench press|chest press/))
    return has(n, /svend|plate press|squeeze press/)
      ? R('squeeze press', ['chest'], ['deltoids', 'triceps'])
      : R('fly', ['chest'], ['deltoids'])
  if (has(n, /dip/)) return R('chest dip', ['chest'], ['triceps', 'deltoids'])
  if (has(n, /push.?up|push up|pushup|press.?up/)) return R('push-up', ['chest'], ['triceps', 'deltoids'])
  return R('chest press', ['chest'], ['triceps', 'deltoids'])
}

function deltFamily(n, e) {
  const R = (rule, p, s = []) => ({ rule, p, s })
  if (has(n, /push press|jerk/)) return R('push press', ['deltoids'], ['triceps', 'quadriceps', 'gluteal', 'trapezius'])
  if (has(n, /press|military|arnold|handstand|pike push|bradford|landmine|z press|overhead|scott/)) return R('overhead press', ['deltoids'], ['triceps', 'trapezius'])
  if (has(n, /\braise\b|raises\b/)) return R('lateral raise', ['deltoids'], ['trapezius'])
  if (has(n, /battling rope|battle rope/)) return R('battle ropes', ['deltoids'], ['forearm', 'abs'])
  if (has(n, /row/)) return R('rear-delt row', ['rear-delts', 'upper-back'], ['trapezius', 'biceps'])
  return R('delts', ['deltoids'], ['trapezius'])
}

function backFamily(n, e) {
  const R = (rule, p, s = []) => ({ rule, p, s })
  if (e.tg === 'traps') return R('traps', ['trapezius'], ['upper-back'])
  if (has(n, /pullover|pull-over/)) return R('pullover (lats)', ['lats'], ['chest', 'triceps', 'serratus'])
  if (has(n, /straight.?arm|pushdown \(straight|incline pushdown|lying extension pullover|rope pulldown.*straight|pushdown/)) return R('straight-arm pulldown', ['lats'], ['triceps'])
  if (has(n, /muscle.?up/)) return R('muscle-up', ['lats'], ['upper-back', 'biceps', 'triceps', 'chest'])
  if (has(n, /pull.?up|pullup|chin.?up|chinup|\bchin\b|pulldown|pull-down|pull down|lat pull|lateral pulldown|rear pulldown|front lever|back lever|archer pull/)) {
    if (has(n, /front lever|back lever/)) return R('lever', ['lats', 'abs'], ['upper-back', 'biceps'])
    return has(n, /chin|underhand|reverse grip|supinat/)
      ? R('chin-up', ['lats'], ['biceps', 'upper-back', 'forearm'])
      : R('pull-up', ['lats'], ['upper-back', 'biceps', 'forearm'])
  }
  if (has(n, /\brows?\b|pull\b|pulls\b|inverted|bodyweight squatting|kayak|twisting pull/)) return R('row', ['upper-back', 'lats'], ['biceps', 'rear-delts'])
  if (has(n, /deadlift|rack pull/)) return R('deadlift', ['gluteal', 'hamstring', 'lower-back'], ['quadriceps', 'adductors', 'trapezius', 'forearm'])
  if (has(n, /superman|extension|hyperextension|good morning/)) return R('back extension', ['lower-back'], ['gluteal', 'hamstring'])
  return R('back', [e.tg === 'lats' ? 'lats' : 'upper-back'], ['biceps'])
}

function legFamily(n, e) {
  const R = (rule, p, s = []) => ({ rule, p, s })
  const barbell = /barbell|smith|trap bar|olympic|ez/.test(e.eq) || has(n, /barbell|smith/)
  if (e.tg === 'abductors' || has(n, /abduct|clamshell|fire hydrant|side.?lying leg (?:lift|raise)|lateral walk|monster walk|side step|hip lift.*side|lying side leg/)) return R('abduction', ['gluteal'])
  if (e.tg === 'adductors' || has(n, /adduct|copenhagen/)) return R('adduction', ['adductors'])
  if (has(n, /leg extension|knee extension|sissy/)) return has(n, /sissy/) ? R('sissy squat', ['quadriceps']) : R('leg extension', ['quadriceps'])
  if (has(n, /leg curl|hamstring curl|nordic|glute.?ham|inverse leg curl|lying femoral|femoral|prone hamstring|leg curl/)) return R('leg curl', ['hamstring'], ['calves'])
  if (has(n, /romanian|stiff.?leg|straight.?leg deadlift|straight leg dead|good morning|single leg deadlift|one leg deadlift|rdl\b/))
    return R('hip hinge', ['hamstring', 'gluteal'], ['lower-back', 'adductors'])
  if (has(n, /deadlift|rack pull/)) return R('deadlift', ['gluteal', 'hamstring', 'lower-back'], ['quadriceps', 'adductors', 'trapezius', 'forearm'])
  if (has(n, /hip thrust|glute bridge|hip bridge|bridge|hip lift|hip raise|lying lifting|pelvic|pull through|pull-through|kickback|donkey kick|hip extension|glute kick|reverse hyper|frog pump|butt lift/))
    return has(n, /pull through|pull-through|kickback|donkey kick|hip extension|reverse hyper|glute kick/)
      ? R('hip extension', ['gluteal'], ['hamstring'])
      : R('hip thrust', ['gluteal'], ['hamstring'])
  if (has(n, /leg press|hack squat|sled|pendulum|belt squat|v squat|v-squat/) && !has(n, /calf/)) return R('leg press', ['quadriceps', 'gluteal'], ['adductors', 'hamstring'])
  if (has(n, /lunge|split squat|bulgarian|step.?up|step up|curtsey|pistol|single leg squat|one leg squat|skater|walking/))
    return R('lunge', ['quadriceps', 'gluteal'], ['adductors', 'hamstring'])
  if (has(n, /jump|box|hop|bound|plyo/)) return R('jump', ['quadriceps', 'gluteal'], ['hamstring', 'calves'])
  if (has(n, /squat|sit.?to.?stand|wall sit|chair/))
    return barbell
      ? R('squat', ['quadriceps', 'gluteal'], ['adductors', 'hamstring', 'lower-back'])
      : R('squat', ['quadriceps', 'gluteal'], ['adductors', 'hamstring'])
  if (has(n, /toe touch/)) return R('toe touch', ['hamstring'])
  if (has(n, /hip (?:internal|external) rotation|lying twist/)) return R('hip mobility', ['gluteal'])
  const map = { glutes: 'gluteal', quads: 'quadriceps', hamstrings: 'hamstring' }
  return R('leg (target)', [map[e.tg]])
}

// Exercises a name pattern cannot place, or places wrongly: [primaries, secondaries].
const IDS = {
  '0012': [['abs', 'obliques'], ['hip-flexors']],                          // leg raise with lateral throw down
  '0020': [['quadriceps'], ['calves']],                                    // balance board
  '0040': [['chest', 'deltoids'], ['lats', 'triceps']],                    // barbell front raise and pullover
  '0100': [['deltoids'], ['trapezius']],                                   // barbell skier
  '0232': [['lats'], ['triceps']],                                         // cable standing pulldown: straight-arm, per its steps
  '0445': [['deltoids', 'trapezius'], ['triceps', 'upper-back']],          // ez anti gravity press: prone incline press
  '0459': [['abs', 'hip-flexors'], []],                                    // flutter kicks (supine)
  '0466': [['lats'], ['biceps', 'upper-back']],                            // gironda sternum chin
  '0467': [['lats', 'abs'], ['biceps', 'upper-back', 'hip-flexors']],      // gorilla chin: chin-up + knee raise
  '0517': [['obliques'], ['deltoids', 'gluteal', 'hamstring']],            // kettlebell advanced windmill
  '0524': [['deltoids', 'obliques'], ['triceps']],                         // kettlebell bent press
  '0530': [['obliques'], ['deltoids', 'gluteal', 'hamstring']],            // kettlebell double windmill
  '0532': [['obliques', 'abs'], ['gluteal', 'hamstring']],                 // kettlebell figure 8
  '0548': [['trapezius', 'deltoids'], ['gluteal', 'quadriceps', 'hamstring', 'adductors']], // kettlebell sumo high pull
  '0554': [['obliques'], ['deltoids', 'gluteal', 'hamstring']],            // kettlebell windmill
  '0555': [['quadriceps', 'hip-flexors'], ['abs']],                        // kick out sit: seated leg kicks
  '0562': [['obliques', 'abs'], ['deltoids']],                             // landmine 180
  '0609': [['upper-back', 'lats'], ['biceps', 'rear-delts']],              // london bridge: a rope row, per its steps
  '0624': [['quadriceps'], ['gluteal', 'hip-flexors']],                    // march sit (wall)
  '0640': [['lats', 'abs'], ['deltoids', 'triceps']],                      // one arm slam
  '0641': [['abs'], ['hip-flexors', 'deltoids']],                          // otis up
  '0642': [['chest'], ['triceps', 'deltoids', 'obliques']],                // outside leg kick push-up
  '0661': [['chest'], ['triceps', 'deltoids', 'obliques']],                // push-up inside leg kick
  '0664': [['chest', 'obliques'], ['triceps', 'deltoids', 'abs']],         // push-up to side plank
  '0680': [['lats', 'biceps'], ['upper-back', 'forearm']],                 // rope climb
  '0709': [['obliques'], ['abs']],                                         // side hip (on parallel bars)
  '0730': [['hamstring'], ['gluteal']],                                    // single leg platform slide
  '0756': [['gluteal'], ['hamstring']],                                    // smith hip raise: a hip thrust, per its steps
  '0776': [['gluteal', 'hamstring', 'quadriceps', 'trapezius'], ['lower-back']], // snatch pull
  '0777': [['obliques', 'abs'], ['deltoids']],                             // spell caster
  '0778': [['chest'], ['triceps', 'deltoids', 'obliques', 'hip-flexors']], // spider crawl push up
  '0786': [['quadriceps', 'gluteal', 'deltoids'], ['triceps', 'trapezius']], // squat jerk
  '0844': [['rear-delts'], ['trapezius', 'upper-back']],                   // weighted round arm: bent-over raise
  '0858': [['abs', 'hip-flexors'], []],                                    // wind sprints (lying)
  '1003': [['quadriceps', 'gluteal', 'upper-back'], ['lats', 'biceps', 'hamstring']], // band squat row
  '1010': [['hamstring', 'gluteal'], ['lower-back', 'adductors']],         // band straight leg deadlift
  '1294': [['chest', 'gluteal'], ['lats', 'triceps', 'hamstring']],        // pullover hip extension on ball
  '1297': [['chest'], []],                                                 // isometric chest squeeze
  '1332': [['upper-back', 'trapezius'], ['rear-delts', 'lower-back']],     // ball alternating arm ups (prone)
  '1338': [['lower-back'], []],                                            // exercise ball hug (stretch)
  '1343': [['gluteal'], ['hamstring', 'lower-back']],                      // exercise ball prone leg raise
  '1353': [['lats', 'abs'], ['deltoids', 'triceps']],                      // medicine ball catch and overhead throw
  '1354': [['lats', 'abs'], ['deltoids', 'triceps']],                      // medicine ball overhead slam
  '1355': [['lats'], []],                                                  // one arm against wall (lat stretch)
  '1362': [['lower-back'], []],                                            // sphinx (stretch)
  '1364': [['lower-back'], ['abs']],                                       // standing pelvic tilt
  '1366': [['abs', 'lower-back'], []],                                     // upward facing dog (stretch)
  '1374': [['quadriceps', 'calves'], ['gluteal']],                         // box jump down with one leg stabilisation
  '1416': [['gluteal'], ['lower-back', 'obliques']],                       // ball one leg prone lower body rotation
  '1496': [['obliques', 'abs'], ['deltoids', 'lats']],                     // sledge hammer
  '3546': [['deltoids'], ['triceps', 'trapezius']],                        // dumbbell seated alternate shoulder (press)
  '3662': [['chest', 'deltoids'], ['triceps', 'lower-back']],              // pike-to-cobra push-up
  '1418': [['lower-back', 'gluteal'], []],                                 // hug knees to chest (stretch)
  '1421': [['triceps', 'abs'], ['chest', 'deltoids']],                     // modified push up to lower arms
  '1471': [['abs'], ['deltoids', 'hamstring']],                            // inchworm
  '1687': [['quadriceps', 'gluteal'], ['abs']],                            // posterior step to overhead reach
  '1688': [['quadriceps', 'gluteal'], ['obliques', 'adductors', 'hamstring']], // lunge with twist
  '1689': [['chest', 'upper-back'], ['triceps', 'biceps']],                // push and pull bodyweight
  '1750': [['chest', 'triceps'], ['deltoids']],                            // medicine ball supine chest throw
  '1772': [['upper-back', 'rear-delts'], ['trapezius']],                   // elbow lift - reverse push-up
  '1774': [['gluteal'], ['obliques']],                                     // side bridge hip abduction
  '1775': [['adductors'], ['obliques']],                                   // side plank hip adduction
  '2139': [['deltoids'], ['chest', 'triceps', 'upper-back']],              // hands bike (arm ergometer)
  '2142': [['lats', 'triceps'], ['abs']],                                  // ski ergometer
  '2203': [['chest'], []],                                                 // roller shoulder flexor mobility
  '2209': [['chest'], []],                                                 // roller single leg shoulder flexor mobility
  '2271': [['deltoids', 'obliques'], ['chest']],                           // left hook (boxing)
  '2459': [['gluteal', 'quadriceps', 'hamstring'], ['lower-back', 'trapezius', 'triceps']], // tire flip
  '3119': [['quadriceps', 'gluteal'], ['adductors', 'hamstring']],         // potty squat
  '3145': [['chest', 'serratus'], ['triceps', 'deltoids']],                // push-up plus
  '3212': [['hamstring'], []],                                             // basic toe touch
  '3214': [['hamstring'], []],                                             // arms apart circular toe touch
  '3215': [['hamstring'], []],                                             // hands reversed clasped circular toe touch
  '3218': [['hamstring'], []],                                             // hands clasped circular toe touch
  '3231': [['hamstring'], []],                                             // two toe touch
  '3291': [['deltoids', 'abs'], ['triceps', 'hip-flexors']],               // stalder press (press to handstand)
  '3292': [['lower-back'], ['hamstring', 'gluteal']],                      // elevator: bodyweight good morning
  '3296': [['lats', 'abs'], ['upper-back', 'biceps']],                     // front lever (hold)
  '3298': [['deltoids', 'chest'], ['triceps', 'abs', 'serratus']],         // straddle planche
  '3299': [['deltoids', 'chest'], ['triceps', 'abs', 'serratus']],         // full planche
  '3300': [['deltoids', 'chest'], ['triceps', 'abs', 'serratus']],         // lean planche
  '3301': [['deltoids', 'chest'], ['triceps', 'abs', 'serratus']],         // frog planche
  '3302': [['deltoids'], ['triceps', 'trapezius']],                        // handstand (hold)
  '3303': [['obliques', 'lats'], ['deltoids', 'abs']],                     // human flag
  '3304': [['lats', 'abs'], ['biceps', 'deltoids']],                       // skin the cat
  '3314': [['deltoids', 'chest'], ['triceps', 'abs', 'serratus']],         // straddle maltese
  '3315': [['deltoids', 'chest'], ['triceps', 'abs', 'serratus']],         // full maltese
  '3327': [['deltoids', 'chest'], ['triceps', 'abs', 'serratus']],         // full planche push-up
  '3418': [['lats', 'abs'], ['biceps', 'upper-back', 'hip-flexors']],      // l-pull-up
  '3419': [['abs', 'hip-flexors'], ['triceps', 'quadriceps']],             // l-sit on floor
  '3433': [['lower-back', 'gluteal'], ['hamstring']],                      // swimmer kicks (prone)
  '3533': [['quadriceps', 'gluteal'], ['adductors', 'hamstring']],         // "quads": a bodyweight squat, per its steps
  '3552': [['calves', 'quadriceps'], []],                                  // quick feet
  '3641': [['deltoids'], ['chest']],                                       // weighted kneeling step with swing: front raise
  '3642': [['quadriceps', 'gluteal'], ['adductors', 'hamstring']],         // weighted stretch lunge
  '3645': [['gluteal'], ['hamstring']],                                    // single leg bridge with outstretched leg
  '3664': [['rear-delts', 'obliques'], ['trapezius', 'upper-back', 'abs']], // side plank with rear fly
  '3669': [['obliques'], ['upper-back']],                                  // standing archer: torso rotation, per its steps
  '3698': [['abs'], ['deltoids', 'hamstring']],                            // inchworm v. 2
}

const VOCABULARY = new Set([...MUSCLES, 'lats', 'rear-delts'])
for (const id of Object.keys(IDS)) if (!EXDB.some(e => e.id === id)) throw new Error(`IDS: no exercise ${id}`)

const out = {}
const report = []
for (const e of EXDB) {
  const f = IDS[e.id] ? { rule: 'by id', p: IDS[e.id][0], s: IDS[e.id][1] } : family(e)
  if (!f) { report.push(`${e.id}|${e.n}|cardio (dataset)|${e.tg}|${(e.sm || []).join(',')}`); continue }
  const primaries = [...new Set(f.p)]
  const secondaries = [...new Set(f.s)].filter(m => !primaries.includes(m))
  const unknown = [...primaries, ...secondaries].find(m => !VOCABULARY.has(m))
  if (unknown || !primaries.length) throw new Error(`${e.id} ${e.n}: ${unknown ? 'unknown muscle ' + unknown : 'no primary'}`)
  out[e.id] = { primaries, secondaries }
  report.push(`${e.id}|${e.n}|${f.rule}|${primaries.join(',')}|${secondaries.join(',')}`)
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 0).replace(/\},"/g, '},\n"').replace(/^\{/, '{\n').replace(/\}$/, '\n}') + '\n')
if (process.argv.includes('--report')) console.log(report.join('\n'))
else console.log(`${Object.keys(out).length} exercises written to ${OUT}`)
