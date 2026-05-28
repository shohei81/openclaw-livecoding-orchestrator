# Bass snippet bank

Short bass phrases. Prefer **sampled bass** (`s("bass:N")` or `note(...).s("bass:N")`) for character; use plain `note(...).s("sine"|"sawtooth")` only when you need pure sub. Default key is A minor; stay below C4.

The dirt-samples library has these bass banks: `bass`, `bass0`, `bass1`, `bass2`, `bass3`, `bassdm`, `bassfoo`. Vary `:N` (e.g. `bass:0`, `bass:2`, `bass1:0`) to change timbre.

## Sample bass — rhythm only (sample's own pitch)
- `s("bass:2")` — one hit per cycle, sample's native pitch
- `s("bass:2 ~ ~ ~")` — bass on the 1, three rests
- `s("bass:2*2")` — half-note pulse
- `s("bass:0 ~ bass:0 ~")` — bass on 1 and 3 with rests
- `s("bass1:0(3,8)").gain(0.8)` — Euclidean bass
- `s("bass:2*2").gain(0.7).lpf(800)` — half-note bass, slightly filtered

## Sample bass — pitched (pitch-shift the sample)
- `note("a2").s("bass:2")` — single root note on bass sample
- `note("a2 e2").s("bass:2")` — root + fifth
- `note("a2 ~ e2 ~").s("bass:2").lpf(600)` — root/fifth on downbeats, filtered
- `note("<a2 c3 e3>").s("bass:2")` — slowly cycling bass notes
- `note("a2 e2 g2 a2").s("bass1:0").lpf(800)` — moving pentatonic bass

## Pure sub-bass (sine / triangle)
- `note("a1").s("sine").gain(0.8)` — fundamental sub, sustained
- `note("a1*2").s("sine").lpf(120)` — sub on every half, very dark
- `note("a1 ~ ~ ~").s("triangle").lpf(200)` — sparse sub root

## Multi-bar phrases (less monotonous)
- `note("<a2 c3 e3 g3>").s("bass:2").slow(2)` — single note held two cycles, evolving
- `note("a2 e2").s("bass:2").slow(2)` — half-tempo two-note figure
- `cat(s("bass:2"), s("bass:2 ~ ~ bass:2"))` — two-bar phrase: simple then syncopated
- `s("bass:2").every(4, x => x.fast(2))` — locked, with a doubling fill every 4 bars
- `note("a2").s("bass:2").every(2, x => x.note("e2"))` — alternates root and fifth every 2 bars

## Variations
- swap `:2` for `:0` `:1` `:3` for a different timbre
- swap `bass:2` for `bass1:0` or `bassdm:0` for very different character
- add `.lpf(400..1000)` to control darkness
- `.gain(0.6..0.9)` to control level
- avoid stacking too many effects — one pitch + one timbre + one filter is plenty
