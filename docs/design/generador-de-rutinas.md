# Generador de rutinas por split (Plan ▸ Generar plan)

> Propuesta de diseño · 2026-10-25 · base: HipertroFit 2.4.6 (`e17cd99`)
> Estado: implementado en 3.0.0 (Plan ▸ Generar plan); este documento queda como referencia de
> diseño. Lo que cambió después —editar el día, superseries— está en Notes Técnicas.

## 0. Cómo encaja el encargo en este código

El encargo da por hecho una base de datos relacional (`exercises`, `user_equipment`, `plans`,
`plan_sessions`…). HipertroFit no tiene SQL: todo el estado de un usuario es **un único documento
JSON** (`S` en `store/useStore.js`, `data/state-<uid>.json` en el servidor, enviado entero con
`PUT /api/data`), y el catálogo de ejercicios es un módulo estático (`lib/exercises-data.js` más
el overlay revisado `lib/exercise-muscles.json`). Por eso cada "tabla" del encargo se traduce aquí
a un campo de `S` o a un dato derivado del catálogo. **El servidor y el MCP no necesitan cambios.**

Buena parte de lo que pide el encargo ya existe. Lo que falta es poco y está bien localizado:

| Requisito | Ya existe | Falta |
|---|---|---|
| Split y nº de sesiones | `STRATEGIES` (`lib/microcycle.js`): full-body 3, upper-lower 4, ppl 6 | Plantillas de días con slots |
| Secuencia de sesiones | `S.program.seq`, `nextStepOf` (puntero posicional que ya tolera sesiones fuera de orden, §3.3), `ProgramSheet` (subir/bajar) | Arrastrar para reordenar |
| Volumen 10–20 series | `VOLUME_TARGET`, `targetOf`, `plannedVolume`, `VolumeGroupBars` (`lib/volume.js`) | Objetivo inicial según el nivel y rampa entre microciclos |
| Material del usuario | `S.equipProfiles`, `activeEquipId`, `exAvailable` (`lib/equipment.js`) | Consulta que no dependa del interruptor `equipFilterOn` |
| Favoritos | — (el selector tiene "Elegidos", que son los ejercicios *usados* alguna vez) | `S.favEx` y un botón para marcarlos |
| Patrón de movimiento | Las ~80 "familias de movimiento" de `scripts/audit-exercise-muscles.mjs`, que hoy solo sirven para deducir músculos y luego se descartan | Guardar `pattern` en el JSON |
| Compuesto / aislamiento | `classifyExercise` → compound / machine / isolation, con su rango de reps | — |
| Progresión de carga | Doble progresión (`lib/progression.js`), descargas (`lib/mesocycle.js`) | Usar el RIR registrado (fase 2) |
| Ajustes revisables | `lib/ai-actions.js` (`volumeProposal`: "Rutina · ejercicio: 3 → 4 series", con confirmación) | Reutilizarlo para la rampa de volumen |

## 1. Resumen ejecutivo

Un asistente en **Plan ▸ Programación ▸ Generar plan** construye un plan completo en cuatro pasos:

1. **Split**: Full Body (3 sesiones por microciclo), Torso/Pierna (4) o PPL (6). Se recomienda uno
   según los días por semana que elija el usuario.
2. **Nivel y contexto**: principiante, intermedio o avanzado. El nivel fija el volumen inicial y
   el techo dentro de la banda de cada grupo muscular, las series por slot, el RIR objetivo y si
   hay variantes A/B. También se eligen aquí el perfil de material y si se registra el RIR.
3. **Slots**: cada sesión es una lista de slots de patrón de movimiento (empuje horizontal,
   bisagra…). Todos llegan **ya rellenos** con la mejor opción, y al tocar uno se abre la lista de
   ejercicios de ese patrón en tres grupos: **Favoritos → Con tu material → Resto**. Mientras se
   edita, las barras de volumen por grupo se recalculan en directo.
4. **Secuencia**: el orden de los días y de los descansos, y la fecha de inicio.

El resultado **no es un motor nuevo**. Son rutinas normales (`S.routines`, en una carpeta propia)
y un programa normal (`S.program`, con `strategy` y `seq`), así que todo lo existente sigue
funcionando sin tocarlo: el entrenamiento, la doble progresión por clase de ejercicio, el panel de
volumen por microciclo, las descargas del mesociclo, el análisis IA y el MCP. Las piezas nuevas son
funciones puras en `src/lib/`, cada una con su test (CONTRIBUTING.md), y un componente para el
asistente.

La progresión del volumen se garantiza con un bucle determinista (§5): se empieza en el volumen
inicial del nivel, al cerrar cada microciclo se propone +1 o +2 series por grupo **solo si** se
hizo lo planificado y el rendimiento no cae, se para en el techo, y el mesociclo termina en una
descarga, que ya existe. Todo se aplica como propuesta revisable, nunca de forma silenciosa.

## 2. Modelo de datos

### 2.1 Patrón de movimiento en el catálogo (`exercises.movement_pattern`)

`scripts/audit-exercise-muscles.mjs` ya clasifica los 1.324 ejercicios en familias de movimiento
("chest press", "row", "hip hinge", "leg curl"…), de la más específica a la más general, y tiene
`IDS` para corregir lo que el nombre no deja leer bien. Hoy la familia solo sirve para deducir los
músculos y no se guarda. Propuesta: que el script emita también un `pattern`, con una tabla
`PATTERN_OF_FAMILY` (familia → patrón), y escribirlo en el mismo `exercise-muscles.json`:

```json
"0025": { "primaries": ["chest"], "secondaries": ["triceps", "deltoids"], "pattern": "horizontal_push" }
```

`catalogueExercise` (`lib/exercises.js`) ya mezcla esos metadatos en cada fila de `CATALOGUE`, así
que `EXIDX[id].pattern` aparece sin tocar nada más. Una sola fuente revisada decide los músculos y
el patrón, y no puede pasar que los dos se lleven la contraria.

Vocabulario de patrones para los slots (`lib/movement-patterns.js`):

| Patrón | Etiqueta | Familias del script |
|---|---|---|
| `horizontal_push` | Empuje horizontal | chest press, push-up, squeeze press, chest dip |
| `incline_push` | Empuje inclinado | chest press / push-up con "incline" en el nombre |
| `vertical_push` | Empuje vertical | overhead press, push press, handstand push-up |
| `chest_fly` | Aperturas | fly, pullover (chest) |
| `lateral_raise` | Elevación lateral | lateral raise, upright row |
| `front_raise` | Elevación frontal | front raise |
| `rear_delt` | Deltoide posterior | face pull, rear-delt row, rear-delt raise |
| `elbow_extension` | Tríceps (extensión de codo) | triceps extension, close-grip press, triceps dip, close push-up |
| `vertical_pull` | Tirón vertical | pull-up, chin-up (incluye los jalones), muscle-up |
| `horizontal_pull` | Tirón horizontal | row |
| `straight_arm_pull` | Tirón con brazo recto | pullover (lats), straight-arm pulldown |
| `elbow_flexion` | Bíceps (flexión de codo) | curl, hammer curl, reverse curl |
| `shrug` | Encogimientos | shrug |
| `squat` | Sentadilla / prensa | squat, leg press (incluye hack, péndulo, belt squat) |
| `lunge` | Zancada / unilateral | lunge (zancadas, búlgaras, step-up) |
| `hinge` | Bisagra de cadera | deadlift, hip hinge |
| `hip_extension` | Extensión de cadera | hip thrust, hip extension |
| `knee_extension` | Extensión de rodilla | leg extension, sissy squat |
| `knee_flexion` | Flexión de rodilla | leg curl |
| `calf_raise` | Gemelo | calf raise |
| `hip_abduction` / `hip_adduction` | Abducción / aducción | abduction / adduction |
| `core_flexion` | Core: flexión | crunch, sit-up, leg raise, abs |
| `core_anti` | Core: anti-extensión y anti-rotación | plank, side plank, rollout, anti-rotation |
| `core_rotation` | Core: rotación | twisting crunch, oblique |
| `null` | No se ofrece en ningún slot | stretch, neck, mobility, jump, carry, olímpicos (clean, snatch, thruster, swing), wrist, rotator cuff, cardio, y las familias de respaldo por músculo ("target", "delts", "back"…) |

Hice una prueba rápida, fuera del repo, con unas 30 expresiones regulares sobre los nombres:
clasifica el **88 %** del catálogo a la primera, y la mayor parte de lo que queda son estiramientos
y movilidad, que deben ir a `null`. Con las familias del script, que ya están afinadas, la
cobertura será mayor.

- **Ejercicios propios** (`S.customEx`): el formulario `CustomExForm` gana un selector opcional
  "Patrón de movimiento". Si no se elige, `patternOf(ex)` devuelve `null` y el ejercicio solo
  aparece en un slot desde "Ver todo el catálogo".
- **Correcciones del usuario**: en fase 3, `S.exPatterns` (`{ id: pattern }`), con el mismo
  mecanismo que `S.exMuscles` / `registerMuscleEdits`.
- `equipment_needed` ya es `ex.eq`, `is_compound` es `classifyExercise(ex)` y
  `muscle_group_primary` es `ex.primaries`.

### 2.2 Favoritos (`user_favorites`)

Un campo nuevo en `DEF`: `favEx: []`, un array de ids de ejercicio. Es un array y no un objeto para
que sea barato y estable al sincronizar. Como `loadState` y `restoredStateFor` superponen `DEF`,
los perfiles antiguos lo reciben vacío sin necesidad de migración.

- Se marca con un botón en `ExerciseDetail` (la ficha del ejercicio), en la fila de la Biblioteca y
  dentro del propio selector de slot.
- No hay que confundirlo con "Elegidos" del `ExercisePicker`, que se calcula por uso
  (`usageMap`) y ya lleva el icono `starFill`. Los favoritos llevan **otro icono** (corazón), y el
  uso queda como criterio de desempate dentro de cada grupo (§4.1).

### 2.3 Material (`user_equipment`)

Ya existe: `S.equipProfiles = [{ id, name, equipment: [...] }]` y `S.activeEquipId`. Lo único
nuevo es una consulta que mire un perfil concreto y no dependa de `equipFilterOn`, que es un filtro
de visualización de la Biblioteca:

```js
// lib/equipment.js
export function ownsEquipment(profile, ex) {
  if (!profile) return null                      // sin perfil: no se sabe (el grupo 2 no se muestra)
  if (!ex.eq || ex.eq === ALWAYS_AVAILABLE) return true
  return profile.equipment.includes(ex.eq)
}
```

El asistente propone el perfil activo (o el primero) y deja cambiarlo. El elegido se guarda en
`program.gen.equipId`.

### 2.4 Plan generado (`plans` y `plan_sessions`)

| Encargo | Aquí |
|---|---|
| `plans` | `S.program` (que ya existe) más un bloque nuevo `program.gen` con los metadatos de la generación |
| `plan_sessions` | Las rutinas de `S.routines` que genera el asistente, cada una con `routine.gen` |
| `session_order` | El índice dentro de `S.program.seq` (ids de rutina y `'rest'`) |
| Puntero a la siguiente sesión | **No se guarda.** Se deriva cada vez con `cyclePosition` / `nextStepOf` |

Que el puntero sea derivado es deliberado y conviene mantenerlo. Un contador guardado se
desincroniza en cuanto se edita un entrenamiento antiguo, se registra uno pasado (`backfill.js`) o
dos dispositivos sincronizan a destiempo. Derivarlo del historial da siempre el valor correcto
(es la filosofía de `progression.js`).

Cada ejercicio generado guarda además su slot (`cfg.slot`), lo que permite más adelante "cambiar
por otro del mismo patrón" desde `RoutineEdit` y que la rampa de volumen prefiera añadir series en
los accesorios.

Siguiendo esa filosofía, **no se guarda nada que se pueda derivar**: los objetivos de volumen salen
del nivel más `targetOf(group)`, y el RIR objetivo sale del nivel más la posición en el mesociclo.

### 2.5 Plantillas de split (datos estáticos)

`lib/split-templates.js` contiene solo datos: días con slots ordenados. Primero va el compuesto
principal (el de mayor demanda), después los compuestos secundarios y al final los aislamientos.

```js
export const SPLITS = {
  ppl: {
    strategy: 'ppl', recommendedDays: [5, 6],
    days: [
      { key: 'push-a', name: 'Push A', glyph: 'bench', slots: [
        { pattern: 'horizontal_push', role: 'main',      prefer: 'compound' },
        { pattern: 'vertical_push',   role: 'secondary' },
        { pattern: 'incline_push',    role: 'secondary', prefer: 'machine' },
        { pattern: 'lateral_raise',   role: 'accessory' },
        { pattern: 'elbow_extension', role: 'accessory' },
        { pattern: 'chest_fly',       role: 'accessory', minLevel: 'intermediate' },
      ] },
      // pull-a, legs-a, push-b, pull-b, legs-b …
    ],
    // Distribución por días/semana: solo afecta al calendario; el conteo de sesiones no ve los descansos.
    layouts: { 6: ['push-a', 'pull-a', 'legs-a', 'push-b', 'pull-b', 'legs-b', 'rest'],
               3: ['push-a', 'rest', 'pull-a', 'rest', 'legs-a', 'rest', 'rest',
                   'push-b', 'rest', 'pull-b', 'rest', 'legs-b', 'rest', 'rest'] },
  },
  'upper-lower': { /* … */ }, 'full-body': { /* … */ },
}
```

Contenido propuesto (el nivel recorta los últimos slots: principiante 5, intermedio 6, avanzado 7):

| Día | Slots |
|---|---|
| **PPL · Push A** | horizontal_push (P) · vertical_push · incline_push · lateral_raise · elbow_extension · chest_fly |
| **PPL · Pull A** | vertical_pull (P) · horizontal_pull · straight_arm_pull · rear_delt · elbow_flexion · shrug |
| **PPL · Legs A** | squat (P) · hinge (RDL) · knee_extension · knee_flexion · calf_raise · core_flexion |
| **PPL · Push B** | incline_push (P) · horizontal_push (máquina/mancuerna) · vertical_push · lateral_raise · elbow_extension · chest_fly |
| **PPL · Pull B** | horizontal_pull (P) · vertical_pull · rear_delt · elbow_flexion · lateral_raise · core_anti |
| **PPL · Legs B** | hinge (P) · squat (máquina) · lunge · knee_flexion · hip_extension · calf_raise |
| **Torso A** | horizontal_push (P) · horizontal_pull (P) · vertical_push · vertical_pull · lateral_raise · elbow_flexion · elbow_extension |
| **Pierna A** | squat (P) · hinge · knee_extension · knee_flexion · calf_raise · core_flexion |
| **Torso B** | vertical_pull (P) · incline_push (P) · horizontal_pull · chest_fly · rear_delt · elbow_extension · elbow_flexion |
| **Pierna B** | hinge (P) · squat (máquina) · lunge · knee_flexion · hip_extension · calf_raise |
| **Full Body A** | squat (P) · horizontal_push (P) · horizontal_pull · lateral_raise · elbow_flexion · core_flexion |
| **Full Body B** | hinge (P) · vertical_push (P) · vertical_pull · lunge · elbow_extension · calf_raise |
| **Full Body C** | squat (máquina) · incline_push · horizontal_pull · knee_flexion · rear_delt · core_anti |

(P) = slot principal. Sin variantes A/B (la opción por defecto para principiantes), PPL y Torso/Pierna
usan solo los días A, repetidos.

### 2.6 Ejemplo: `S` justo después de generar

```jsonc
{
  "favEx": ["0025", "2330"],
  "activeEquipId": "eqm1x9",
  "equipProfiles": [{ "id": "eqm1x9", "name": "Gimnasio", "equipment": ["barbell", "dumbbell", "cable", "leverage machine"] }],
  "folders": [{ "id": "f7", "name": "PPL · Intermedio", "open": true }],
  "routines": [
    { "id": "r1", "name": "Push A", "emoji": "bench", "folder": "f7",
      "gen": { "plan": "g1", "day": "push-a" },
      "ex": [
        { "id": "0025", "sets": 3, "repsMin": 5, "reps": 12, "prog": "double", "weight": 80, "restSec": 180,
          "slot": { "pattern": "horizontal_push", "role": "main" } },
        { "id": "0405", "sets": 3, "repsMin": 5, "reps": 12, "prog": "double", "weight": 22,
          "slot": { "pattern": "vertical_push", "role": "secondary" } }
        // …
      ] }
    // r2…r6
  ],
  "program": {
    "on": true, "strategy": "ppl", "anchor": "2026-10-27", "cycleStart": "2026-10-27",
    "seq": ["r1", "r2", "r3", "r4", "r5", "r6", "rest"],
    "gen": { "id": "g1", "v": 1, "split": "ppl", "level": "intermediate", "daysPerWeek": 6,
             "variants": true, "equipId": "eqm1x9", "createdAt": "2026-10-25" }
  }
}
```

`ProgramSheet` y `closeMicrocycle` ya conservan los campos que no conocen (`...prev`), así que
`program.gen` sobrevive a las ediciones manuales. `previousRoutineConfig`
(`lib/exercise-defaults.js`) copia la configuración de un ejercicio a otra rutina: tiene que quitar
`slot` igual que ya quita `sg`.

## 3. Flujo de usuario

### 3.1 Del split a la primera sesión

1. **Entrada.** Plan ▸ Programación ▸ fila nueva "Generar plan" (icono `sparkles`). Con el plan
   vacío, el botón aparece también junto a "Cargar plan inicial (PPL)".
2. **Paso 1 · Días y split.** Selector de días por semana (2–6). Las tres tarjetas de split
   muestran sesiones por microciclo y para quién son, y la recomendada va marcada: 2–3 días →
   Full Body, 4 → Torso/Pierna, 5–6 → PPL. Se puede elegir otra (ver el aviso de §8.1).
3. **Paso 2 · Nivel y contexto.** Tres opciones de nivel, cada una con lo que implica (tabla de
   §4.3). Interruptor "Variantes A/B", desactivado por defecto en principiante. Perfil de material
   (o "Sin perfil: todo disponible"). Interruptor "Registrar RIR", que pone `S.effort = 'rir'`,
   recomendado porque la fase 2 lo usa.
4. **Paso 3 · Sesiones.** Una pestaña por día (Push A, Pull A…). Cada día es una lista de slots
   **ya rellenos** con `autoPick`: el plan es válido sin tocar nada. Al tocar un slot se abre su
   selector (§6.2). Cada slot tiene ± series, quitar, y "Añadir slot" (que pide el patrón). Arriba
   están las barras de volumen planificado por microciclo (`VolumeGroupBars` con `plannedVolume`
   del borrador), que se recalculan con cada cambio.
5. **Paso 4 · Secuencia.** El orden de los días y los descansos, con la distribución por días por
   semana ya aplicada. Se reordena arrastrando o con subir/bajar, y se elige la fecha de inicio.
   Al final, un resumen: rutinas, ejercicios, sesiones por microciclo y barras de volumen.
6. **Crear plan.** `applyPlan` (§4.4) escribe las rutinas en una carpeta "PPL · Intermedio",
   activa el programa (`strategy`, `seq`, `cycleStart`) y reinicia el mesociclo. Si ya había un
   programa activo, primero pide confirmación: las rutinas anteriores no se borran, solo se
   sustituye la secuencia. Aviso: "Plan creado: 6 sesiones por microciclo".
7. **Primera sesión.** Inicio muestra "Hoy: Push A" (`effectiveRoutineId` → `nextStepOf`).
   Iniciar → `startFlow`. Cada ejercicio trae su rango de reps por clase y el peso de la última
   sesión, o 0 si no hay historial. Sin historial, la primera sesión sirve de **calibración**: se
   elige una carga que deje el RIR objetivo y la doble progresión parte de ahí. Al terminar,
   `finish-workout.js` reduce la sesión y el puntero pasa a Pull A.

### 3.2 Siguiente sesión

Ya funciona así y no se cambia: la sesión que toca sale de la **posición** en el bloque, no de la
fecha. Los días de descanso no cuentan, así que si se entrena el martes o el jueves, lo que se haga
es el siguiente paso. La posición distingue además "Legs A" de "Legs B" aunque se repita el tipo de
día (`microcycle.js`).

### 3.3 Cambiar el orden (y un fallo que hay que corregir antes)

Hay dos formas de cambiar el orden:

- **Permanente**: reordenar `program.seq` en `ProgramSheet`. Hoy se hace con subir/bajar. La
  propuesta es arrastrar con el mismo motor de muelles que la lista de rutinas de Plan
  (`routineMagnets.js`). La estructura no se pierde porque se reordenan ids y las rutinas no se
  tocan.
- **Puntual** ("hoy hago Pierna en vez de Pull"): basta con iniciar otra rutina del bloque.

**Fallo corregido (fase 0, punto 1, ya hecho).** Con la secuencia `[push, pull, legs]`, si después
de Push se entrenaba Legs fuera de turno, `nextStepOf` volvía a proponer **Legs** y Pull se perdía,
porque el puntero solo contaba sesiones (`step = sesiones % len`). Ahora un helper interno,
`blockFill` (`lib/microcycle.js`), repasa las sesiones del bloque en orden y cada una ocupa la
primera posición abierta de su rutina. Así una sesión fuera de turno ocupa su propio paso y deja
abierto el que se saltó. Una sesión sin paso propio abierto (una rutina que no está en la
secuencia, o una que se repite más veces de las que el bloque planifica) sustituye al paso que
tocaba, como antes, y el bloque sigue cerrándose por número de sesiones.

- `nextStepOf` devuelve el paso de la primera posición abierta.
- `cycleStrip` pone primero las sesiones hechas, en el orden en que se entrenaron, y después los
  pasos abiertos en el orden de la secuencia. "Siguiente" coincide siempre con el contador
  "Sesión n de m".

`history.effectiveRoutineId` (el "Hoy" de Inicio), `ai-digest` y los recordatorios de `mobile.js`
llaman a `nextStepOf`, así que heredan la corrección. Hay cinco tests nuevos en
`microcycle.test.js`.

## 4. Algoritmo de selección de ejercicios

Todo vive en `lib/plan-generator.js`, sin React, con `plan-generator.test.js` al lado.

### 4.1 `candidatesFor`: la lista agrupada de un slot

```js
// slot: { pattern, role, prefer? } · ctx: { profile, draft, dayKey }
export function candidatesFor(S, slot, ctx) {
  const usage = usageCounts(S)                       // veces en rutinas y entrenamientos (como usageMap)
  const fav = new Set(S.favEx || [])
  const pool = allExercises(S).filter(ex =>
    patternOf(ex) === slot.pattern &&
    modeOf({ id: ex.id }) === 'reps' &&                // un slot de fuerza no ofrece cardio ni isométricos
    !usedInDay(ctx.draft, ctx.dayKey, ex.id))          // nunca el mismo ejercicio dos veces en un día

  const groups = { favorites: [], owned: [], rest: [] }
  for (const ex of pool) {
    const owns = ownsEquipment(ctx.profile, ex)      // true / false / null (sin perfil)
    const row = { ex, owns, score: scoreFor(S, ex, slot, ctx, usage),
                  elsewhere: usedElsewhere(ctx.draft, ctx.dayKey, ex.id) }   // "ya en Push B"
    if (fav.has(ex.id)) groups.favorites.push(row)   // favorito aunque no haya material (se marca)
    else if (owns !== false) groups.owned.push(row)  // sin perfil, todo cuenta como disponible
    else groups.rest.push(row)
  }
  for (const g of Object.values(groups)) g.sort((a, b) => b.score - a.score || nameCmp(a.ex, b.ex))
  return groups
}
```

`scoreFor` ordena dentro de cada grupo. Son pocos términos, cada uno explicable con una etiqueta
en la interfaz:

| Término | Peso | Por qué |
|---|---|---|
| Encaje de clase con el rol (`classifyExercise`) | +3 | Un slot principal pide un compuesto, un accesorio pide máquina o aislamiento, y `prefer` lo afina |
| Uso previo (`usage`, log2) | hasta +3 | Lo que ya se hace tiene historial y la progresión arranca con datos |
| Tiene imagen o gif | +1 | Se reconoce mejor y tiene instrucciones visuales |
| Material poco habitual (bosu, stability ball, tire…) | −2 | El catálogo tiene mucho ruido y estas opciones rara vez son las que se buscan |
| Variante de nombre (`v. 2`, `(male)`) | −1 | Se prefiere la forma canónica |
| Ya usado en otro día del plan | −2 | Variedad entre A y B, aunque sigue permitido |

### 4.2 `autoPick`: el relleno inicial

```js
export const autoPick = (S, slot, ctx) => {
  const g = candidatesFor(S, slot, ctx)
  return (g.favorites.find(r => r.owns !== false) || g.owned[0] || g.favorites[0] || g.rest[0])?.ex || null
}
```

Va primero un favorito que se pueda hacer con el material, después lo mejor con el material, y
solo al final algo sin material. Un slot sin candidatos se queda vacío y marcado ("Elige un
ejercicio"), sin bloquear la creación del plan.

### 4.3 Series y volumen inicial según el nivel

En esta app el volumen se cuenta **por microciclo**, no por semana (`volume.js`). PPL son 6
sesiones, Torso/Pierna 4 y Full Body 3. Las bandas por grupo ya existen (`targetOf(g)`): 10–20 en
general, con bandas propias para las partes cuando Espalda o Piernas van desglosadas (cuádriceps
8–18, glúteos 4–12…). El nivel decide en qué punto de la banda se empieza y hasta dónde se sube:

```js
const LEVEL = {
  beginner:     { start: 0.0, ceil: 0.4, sets: { main: 3, secondary: 2, accessory: 2 }, slots: 5, rir: [3, 3, 2], step: 1, variants: false },
  intermediate: { start: 0.2, ceil: 0.8, sets: { main: 3, secondary: 3, accessory: 2 }, slots: 6, rir: [3, 2, 1], step: 2, variants: true },
  advanced:     { start: 0.4, ceil: 1.0, sets: { main: 4, secondary: 3, accessory: 3 }, slots: 7, rir: [2, 1, 1], step: 2, variants: true },
}
export const startTarget = (g, lvl) => { const t = targetOf(g); return Math.round(t.min + (t.max - t.min) * LEVEL[lvl].start) }
export const ceilTarget  = (g, lvl) => { const t = targetOf(g); return Math.round(t.min + (t.max - t.min) * LEVEL[lvl].ceil) }
```

| Banda | Principiante | Intermedio | Avanzado |
|---|---|---|---|
| General 10–20 | 10 → 14 | 12 → 18 | 14 → 20 |
| Cuádriceps 8–18 | 8 → 12 | 10 → 16 | 12 → 18 |
| Glúteos 4–12 | 4 → 7 | 6 → 10 | 7 → 12 |

Los erectores (0–6, solo trabajo directo) no se persiguen: ya les llega volumen indirecto de los
compuestos.

**`balanceSets`.** Después de elegir los ejercicios (las series dependen de ellos: unos fondos dan
tríceps y un press de banca no da lo mismo), se ajustan las series del borrador hasta que cada
grupo quede en su objetivo inicial con una tolerancia de ±1. Usa la misma acreditación que el
panel, construyendo un `S` provisional:

```js
export function balanceSets(S, draft, level) {
  for (let pass = 0; pass < 60; pass++) {
    const vol = plannedVolume({ ...S, routines: draft.routines, program: draft.program }).groups
    const g = worstGroup(vol, level)                 // mayor |vol − startTarget| fuera de ±1
    if (!g) return draft
    const dir = vol[g.key] < startTarget(g, level) ? +1 : -1
    // Para subir se elige el slot que más mueve g (primero accesorios: menos fatiga sistémica).
    // Para bajar se elige el que menos daña a los grupos que ya están en objetivo.
    const slot = pickSlot(draft, g, dir)
    if (!slot) { g.unreachable = true; continue }    // la interfaz lo indica ("faltan ejercicios de bíceps")
    slot.sets += dir                                  // límites por rol: main 2–5, secondary 2–4, accessory 1–4
  }
  return draft
}
```

Es la misma idea voraz y acotada de `volumeProposal` (`ai-actions.js`, `MAX_STEP`), pero contra
un objetivo arbitrario en lugar del borde de la banda. Conviene extraer el núcleo común (elegir el
ejercicio que más mueve un grupo) a un helper compartido en vez de duplicarlo.

### 4.4 `buildPlan` y `applyPlan`

```js
// Puro: no toca S. Lo usan el asistente (vista previa) y los tests.
export function buildPlan(S, { split, level, variants, daysPerWeek, equipId, picks = {} }) {
  const tpl = SPLITS[split], lvl = LEVEL[level]
  const days = tpl.days.filter(d => variants || !d.key.endsWith('-b'))
  const routines = days.map(d => ({
    id: uid(), name: d.name, emoji: d.glyph, gen: { day: d.key },
    ex: d.slots.filter(s => levelAllows(s, level)).slice(0, lvl.slots).flatMap((slot, i) => {
      const ex = picks[d.key + '.' + i] || autoPick(S, slot, ctx(S, equipId, d.key))
      if (!ex) return []
      const cfg = seedConfig(routineExerciseConfig(S, ex), S.exDefaults?.[ex.id], 'reps')   // doble progresión + rango de clase; exDefaults gana
      return [{ ...cfg, sets: lvl.sets[slot.role], slot: { pattern: slot.pattern, role: slot.role } }]
    }),
  }))
  const seq = layoutFor(tpl, daysPerWeek, variants).map(k => k === 'rest' ? REST : routines.find(r => r.gen.day === k).id)
  return balanceSets(S, { routines, program: { seq, strategy: tpl.strategy } }, level)
}

// Escribe en S dentro de un único update().
export function applyPlan(s, draft, meta, today = todayISO()) {
  const folder = { id: uid(), name: meta.folderName, open: true }
  s.folders.push(folder)
  draft.routines.forEach(r => { r.folder = folder.id; r.gen.plan = meta.id; s.routines.push(r) })
  const closed = closeMicrocycle(s, draft.program.strategy, today)    // cycleStart correcto aunque hoy ya haya sesión
  s.program = { ...closed, on: true, seq: draft.program.seq, anchor: closed.cycleStart, gen: meta }
  s.meso = restartMeso(s)                                               // el mesociclo nuevo empieza en #1
}
```

`policyFor` y su fallback lineal **no se tocan** (CLAUDE.md): el generador pone `prog: 'double'`
de forma explícita en cada ejercicio, igual que hoy `routineExerciseConfig`.

## 5. Progresión: cómo se garantiza

Hay dos bucles con escalas de tiempo distintas, y los dos se derivan del historial.

### 5.1 Carga y repeticiones (cada sesión, cada ejercicio): ya existe

Cada ejercicio generado usa **doble progresión** con el rango de su clase: compuesto 5–12, máquina
8–10, aislamiento 10–20 (`CLASS_REP_RANGE`). Cuando se llega al tope del rango en todas las series,
sube la carga y las reps vuelven al mínimo. Si una sesión falla, la carga no sube (`readSession` es
estricto). Tras 3 sesiones estancado, descarga del 10 % (`DELOAD_AFTER.double`). Todo esto ya está
probado en `progression.test.js`.

**Fase 2: lectura del RIR.** Solo actúa si `S.effort` es `'rir'` o `'rpe'`. Es una función pura,
`effortVerdict(sessions, rirTarget)`, que consulta `nextPrescription`:

| Situación en la última sesión | Ajuste |
|---|---|
| Tope del rango en todas las series y RIR medio ≥ objetivo + 2 | Subida doble en compuestos (2 escalones de `load-scale`) y simple en aislamientos |
| Por debajo del tope pero RIR ≥ objetivo + 2 | Sin cambio de carga. Aviso: "te quedan reps; acércate a RIR {n}" |
| RIR ≤ objetivo − 2 y las reps caen respecto a la sesión anterior | Cuenta como sesión estancada aunque se llegara a las reps, así que la descarga llega antes |
| En otro caso | La doble progresión de siempre |

Como el motor de progresión ya ha tenido dos fallos que solo detectó un test, esta parte se
escribe **primero el test**.

### 5.2 Volumen por grupo (cada microciclo): nuevo, como propuesta

Al cerrarse un microciclo (al cerrarlo a mano en `MicrocycleActions` o cuando el puntero da la
vuelta), `lib/volume-ramp.js` calcula para cada grupo `g`:

- **Adherencia**: `cycleVolume(S).groups[g] / plannedVolume(S).groups[g]`.
- **Rendimiento**: en los ejercicios que trabajan `g` como primario, si progresan o se estancan
  (`sessionsFor` + `stallCount`).
- **Esfuerzo**, si se registra: RIR medio de las series de `g` frente al objetivo del microciclo.

Con esos tres datos se decide:

```
si adherencia < 90 %                          → mantener (no se sube lo que no se hace)
si ≥ la mitad de sus ejercicios estancados
   o RIR medio < objetivo − 1                  → mantener (o −1 si está cerca del techo)
si planificado + step > ceilTarget(g)          → mantener en el techo
en otro caso                                   → +step series (principiante 1, resto 2)
```

La salida es una propuesta del mismo tipo que las de `ai-actions.js`: una lista del estilo
"Push A · Aperturas: 2 → 3 series". Las series nuevas van primero a los slots `accessory`
(`cfg.slot.role`). Se aplica solo tras confirmar y se rechaza si las rutinas cambiaron desde que se
calculó. Nada se reescribe en silencio.

**Cierre del mesociclo.** `mesocycle.js` ya sugiere una descarga después de `DELOAD_AFTER = 3`
microciclos de carga (y la impone a los 5), con un 25–50 % menos de trabajo. Después de la
descarga, el volumen vuelve al objetivo inicial, **más una serie** si el mesociclo cerró con
progreso en ese grupo. Así el punto de partida también avanza de un mesociclo al siguiente.

### 5.3 RIR objetivo según la posición en el mesociclo

Se deriva y no se guarda: `rirTargetFor(S) = LEVEL[gen.level].rir[min(i, len − 1)]`, donde `i`
es el número de microciclos de carga desde la última descarga (`mesoState`). Si se aplaza la
descarga, se mantiene el último valor. En descarga, RIR 4 o más. Se muestra en el entrenamiento
("Objetivo: RIR 2") y en la cabecera de cada ejercicio.

### 5.4 Ejemplo numérico: pecho, intermedio, PPL 6 días

| Microciclo | RIR obj. | Series de pecho planificadas | Por qué |
|---|---|---|---|
| 1 | 3 | 12 | Objetivo inicial del intermedio (10 + 0,2 × 10) |
| 2 | 2 | 14 | Adherencia 100 %, el press de banca progresa → +2 |
| 3 | 1 | 16 | Igual → +2 |
| 4 | 4+ | ≈10 (−40 %) | Descarga sugerida tras 3 microciclos de carga |
| 5 | 3 | 13 | Mesociclo nuevo: objetivo inicial + 1 por el progreso del anterior |
| 6 | 2 | 15 | +2 |
| 7 | 1 | 15 | Las aperturas llevan 2 sesiones estancadas → se mantiene |

El techo de 18 marca el límite: si se llega a él, el volumen ya no sube más, y lo que falta lo
cubren la carga (la doble progresión) y la descarga.

## 6. UX/UI

### 6.1 Principios

- **Sin pantalla en blanco**: todo llega relleno y el usuario corrige. "Crear plan" está activo
  desde el paso 3.
- **Ver el efecto de cada cambio**: las barras de volumen están siempre a la vista en el paso 3.
  Son el mismo componente que Inicio, Estadísticas y Programación, así que el usuario ya sabe
  leerlas.
- **Toda sugerencia se puede explicar**: cada fila del selector dice por qué está ahí (favorito,
  tienes el material, la has usado 12 veces, ya está en Push B).
- **Táctil primero**: el asistente se prueba en Android. Las listas van dentro de hojas, y el
  arrastre del paso 4 usa el mismo motor de pulsación larga que Plan. Hay que evitar gestos
  anidados dentro de `ScreenSlider`, que captura cada pulsación.

### 6.2 Selector de un slot

```
┌ Empuje horizontal · principal ────────────────────┐
│ ⌕ Buscar en 76 ejercicios                         │
│                                                    │
│ ♥ FAVORITOS (2)                                    │
│ [img] Press de banca (barra)        Compuesto  ✓   │
│ [img] Fondos en paralelas    ⚠ Sin material: Casa │
│                                                    │
│ ⌂ CON TU MATERIAL · GIMNASIO (31)                  │
│ [img] Press con mancuernas      Usado 12×      ♡   │
│ [img] Press en máquina          Máquina        ♡   │
│ [img] Press declinado           Ya en Push B   ♡   │
│   Mostrar 26 más                                   │
│                                                    │
│ ▸ RESTO (43)                                       │
│ Ver todo el catálogo                               │
└────────────────────────────────────────────────────┘
```

- Grupos con cabecera fija y contador. "Resto" empieza plegado si hay más de 10. Se muestran 5
  filas por grupo y "Mostrar más", igual que el `ExercisePicker` actual.
- La búsqueda filtra dentro del patrón, y "Ver todo el catálogo" abre el `ExercisePicker` de
  siempre como salida de emergencia (por ejemplo, para un ejercicio propio sin patrón).
- El ♡ de cada fila marca el favorito al momento. La fila **no salta** de grupo mientras la hoja
  está abierta, porque se reordena la próxima vez que se abre: así no se pierde el punto de lectura
  con el dedo.
- Sin perfil de material, el grupo 2 no aparece y se muestra un aviso: "Configura tu material en
  Ajustes para ver primero lo que puedes hacer".
- Sin favoritos, una línea: "Marca ♡ en los ejercicios que prefieras y aparecerán aquí".
- La ficha (`exerciseDetailSheet`) se abre con pulsación larga o con el icono de información,
  para ver el gif antes de elegir.

### 6.3 Paso 3: el día como lista de slots

```
 Push A   Pull A   Legs A   Push B   Pull B   Legs B
 ───────
 VOLUMEN / MICROCICLO   Pecho ███████░ 12  Hombro ████░ 11 …
 1  Empuje horizontal · P   [img] Press de banca        − 3 +   ›
 2  Empuje vertical         [img] Press militar         − 3 +   ›
 3  Empuje inclinado        [img] Press inclinado máq.  − 3 +   ›
 4  Elevación lateral       [img] Elev. lateral polea   − 2 +   ›
 5  Tríceps                 [img] Extensión en polea    − 2 +   ›
 6  Aperturas               [img] Contractora           − 2 +   ›
    + Añadir slot
```

Cada fila muestra el patrón (el "qué") y el ejercicio (el "con qué"), separados, porque el usuario
cambia el ejercicio, no el patrón. Un grupo que no llega a su objetivo pone su barra en naranja y
enlaza al slot que lo arreglaría: "Bíceps 6/12 · añade series a Curl".

### 6.4 Paso 4: la secuencia

Es la lista de `ProgramSheet` con arrastre: número, icono, nombre y descanso en gris. Encima hay
plantillas de distribución según los días por semana ("6 seguidos + 1 descanso", "alternos") y
debajo la vista de los próximos 14 días que ya existe. Un texto aclara que los descansos solo
afectan al calendario y que, si un día se entrena en vez de descansar, se hace la siguiente sesión.

### 6.5 Después de crear

- En Plan aparece la carpeta "PPL · Intermedio" con sus rutinas y la fila de Programación
  "Ciclo de 7 días · activo".
- En Inicio, la tarjeta del microciclo muestra "Microciclo #1 · PPL", con la tira de 6 sesiones y
  la actual marcada.
- En `RoutineEdit`, cada ejercicio generado tiene la acción "Cambiar por otro de *Empuje
  horizontal*", que abre el selector de §6.2 (fase 2).

### 6.6 Textos

Todo pasa por `t()`, y las claves nuevas se añaden a los 14 catálogos de `locales/` porque
`check-locales.mjs` lo vigila. En español se usan "Dropset" y "Rest-Pause" tal cual (`es.js`), y
"Push / Pull / Legs" se queda como nombre propio del split, como ahora.

## 7. Plan de implementación por fases

Cada fase se puede publicar por separado y deja la app en un estado coherente.

### Fase 0: datos y una corrección (sin el asistente todavía)

1. ~~**Puntero tolerante al orden** en `microcycle.js` (`nextStepOf` y `cycleStrip`), con tests
   para fuera de orden, rutinas repetidas A/B y bloque completo.~~ Hecho (§3.3).
*Puntos 2 a 4 hechos: `pattern` en `exercise-muscles.json`, `lib/movement-patterns.js`,
`lib/favorites.js` (`S.favEx`, corazón en la ficha, chip «Favoritos» en la Biblioteca, favoritos
primero en el selector) y selector de patrón en el ejercicio propio, que también viaja en el
archivo del plan.*

2. **Patrón en el catálogo**: `PATTERN_OF_FAMILY` en `scripts/audit-exercise-muscles.mjs` (más el
   corte por "incline"), regenerar `exercise-muscles.json` y crear `lib/movement-patterns.js`
   (`PATTERNS`, etiquetas, `patternOf`). Tests:
   - todo ejercicio de reps que no sea estiramiento tiene patrón o está en una exclusión explícita;
   - ejemplos fijados (press banca → `horizontal_push`, RDL → `hinge`, jalón → `vertical_pull`,
     prensa → `squat`…);
   - cada patrón de slot tiene al menos 5 candidatos con material común.
3. **Favoritos**: `favEx` en `DEF`, botón en `ExerciseDetail` y en la Biblioteca, chip
   "Favoritos" en la Biblioteca, y que el `ExercisePicker` ponga los favoritos primero.
4. Selector de patrón opcional en `CustomExForm`.

### Fase 1: MVP del generador

*Hecha: `lib/split-templates.js`, `lib/plan-generator.js` (con `balanceSets` sobre los grupos y
bandas del panel de volumen), `components/PlanGenerator.jsx` (Plan ▸ Programación ▸ «Generar
plan» y el estado vacío) y 53 textos en los 14 idiomas. Sin selector de fecha de inicio: el
microciclo empieza hoy (o mañana si ya hay sesión hoy) y se cambia en Programación.*

5. `lib/split-templates.js` (datos) y `lib/plan-generator.js` (`candidatesFor`, `autoPick`,
   `balanceSets`, `buildPlan`, `applyPlan`), con tests:
   - orden de los grupos (favoritos → material → resto);
   - nunca un ejercicio repetido en el mismo día;
   - los objetivos iniciales se alcanzan con ±1;
   - `exDefaults` gana a lo sembrado;
   - `applyPlan` no toca rutinas existentes y reinicia el mesociclo.
6. `components/PlanGenerator.jsx`: hoja de 4 pasos (sobre `SlideDeck` o con pasos simples), con
   entrada en `Plan.jsx` y en el estado vacío. Test de componente al estilo de
   `RoutineEdit.*.test.jsx`.
7. `ownsEquipment` en `equipment.js` y textos nuevos en los 14 idiomas.
8. Sin rampa todavía: el plan empieza en el objetivo inicial y lo que ya existe (doble progresión
   y descargas) se encarga de progresar.

### Fase 2: progresión guiada

9. `lib/volume-ramp.js` y su propuesta al cerrar el microciclo, en `MicrocycleActions`,
   reutilizando la interfaz de propuestas de `ai-actions`.
10. `rirTargetFor` mostrado en el entrenamiento, y `effortVerdict` dentro de `nextPrescription`
    (test primero).
11. Arrastrar para reordenar en `ProgramSheet`.
12. "Cambiar por otro del mismo patrón" en `RoutineEdit`, usando `cfg.slot`.

### Fase 3: extras

13. `program.gen` en `ai-digest` / `training_analysis` del MCP y en `plan-share.js`.
14. Split híbrido de 5 días (Torso/Pierna + PPL), plantillas guardadas por el usuario, intervalo
    de descarga según el nivel, `S.exPatterns` para corregir patrones, y agrupar las variantes de
    nombre en el selector.

## 8. Riesgos y decisiones

1. **Microciclo frente a semana.** La banda 10–20 de la app se mide por microciclo. PPL con 3 días
   por semana alarga el microciclo a unas dos semanas, y el volumen semanal se queda en la mitad.
   El asistente lo avisa al elegir PPL con menos de 5 días ("tu microciclo durará unas 2 semanas")
   y recomienda Full Body o Torso/Pierna, pero no lo impide. Cambiar la unidad de medida está
   fuera de alcance: afectaría al panel, a la IA y al MCP.
2. **Errores de clasificación.** Se mitigan con el informe `--report` del script, con `IDS` para
   corregir casos concretos y con la salida "Ver todo el catálogo". Un patrón mal asignado solo
   desordena una lista: no rompe ningún cálculo.
3. **Ruido del catálogo.** Con 1.324 ejercicios y muchas variantes, el orden por puntuación
   (§4.1) importa más que el filtro. Conviene revisar a mano los 5 primeros de cada patrón antes de
   publicar.
4. **Sustituir un programa activo.** Se pide confirmación. Las rutinas anteriores se conservan y
   solo se sustituye `seq`. El mesociclo se reinicia.
5. **Compatibilidad.** Todos los campos nuevos son opcionales y `DEF` los rellena. No hay
   migración ni cambios en `api/` o `mcp/`, y el estado crece unos pocos KB.
6. **Dependencias.** Ninguna nueva.

**Decisiones pendientes** (con la opción recomendada primero):

- Favoritos: una lista explícita nueva (`favEx`), con el uso como desempate, **o** reutilizar
  "Elegidos" (que se calcula por uso).
- Variantes A/B por defecto en intermedio: **sí**, o no.
- El plan generado va a una carpeta propia: **sí**, o sueltas.
