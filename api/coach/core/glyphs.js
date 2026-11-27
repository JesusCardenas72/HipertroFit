// A routine's icon, as the Coach reads and writes it (#311).
//
// A routine's `emoji` holds an icon key now ('figureStrength'), a legacy emoji only on old state —
// and the model copies whichever it sees in the plan. It is stored in the routine and sent back
// to the model with the plan on every later job, so it is not free text: an icon key a routine
// can hold, or a legacy emoji made of pictographs and their joiners only — no letter, digit or
// tag character in any script, so no words fit through. Anything else becomes the default icon.
//
// The keys are the app's (frontend/src/lib/glyphs.js); coach-parity.test.js holds the two lists
// together, so a round trip through a plan never resets an icon the app shows.

// What the picker offers today.
// HipertroFit's picker (frontend/src/lib/glyphs.js GLYPH_GROUPS), split days and muscle maps included.
export const ROUTINE_GLYPHS = [
  'pushDay', 'pullDay', 'legDay', 'upperDay', 'fullBody',
  'chest', 'shoulders', 'biceps', 'forearms', 'core', 'triceps', 'lats', 'upperBack', 'lowerBack',
  'glutes', 'quads', 'hamstrings', 'calves',
  'figureStrength', 'dumbbell', 'barbell', 'kettlebell', 'machine',
  'figureRun', 'bike', 'swim', 'boxing', 'timer',
  'stretch', 'moon', 'heart', 'flame', 'bolt'
];
// What a routine may still hold: keys the picker used to offer (redrawn as the new ones), and
// the icons old emoji map onto. The app renders each (lib/glyphs.js glyphOf).
export const LEGACY_ROUTINE_GLYPHS = ['bench', 'pullup', 'squat', 'arm', 'abs', 'legs', 'trophy', 'medal', 'crown', 'flag', 'star', 'target', 'shield'];
export const DEFAULT_GLYPH = 'figureStrength';

const KNOWN = new Set([...ROUTINE_GLYPHS, ...LEGACY_ROUTINE_GLYPHS]);
// Pictographs with their joiners, variation selectors and skin tones — or a single flag, which is
// the one emoji spelled with letters (two regional indicators). A run of them is not a flag but
// a word, so no more than the one pair, and nothing else beside it.
const PICTOGRAPHS = /^(?:\p{Extended_Pictographic}|[‍️\u{1F3FB}-\u{1F3FF}])+$/u;
const FLAG = /^[\u{1F1E6}-\u{1F1FF}]{2}$/u;

export const glyphStr = v => {
  if (typeof v !== 'string' || !v) return DEFAULT_GLYPH;
  if (KNOWN.has(v)) return v;
  return v.length <= 16 && (PICTOGRAPHS.test(v) || FLAG.test(v)) ? v : DEFAULT_GLYPH;
};
