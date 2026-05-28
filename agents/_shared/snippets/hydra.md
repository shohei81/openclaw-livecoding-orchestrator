# Hydra snippet bank

Short Hydra fragments. Each one ends in `.out(o0)`. Pick a source, optionally apply 1–3 transforms, end with `.out(o0)`. Avoid stacking too many transforms — three is plenty.

## Pure sources
- `osc(20, 0.1, 1).out(o0)` — moving stripes
- `osc(60, 0.05, 0.5).out(o0)` — dense stripes, slow motion
- `noise(3, 0.1).out(o0)` — soft cloud noise
- `noise(10).out(o0)` — finer grain noise
- `voronoi(8, 0.2, 0.3).out(o0)` — cellular pattern, slow
- `gradient(1).out(o0)` — animated hue gradient
- `shape(4, 0.4, 0.05).out(o0)` — soft-edged square
- `solid(0.1, 0.1, 0.2, 1).out(o0)` — flat dark blue

## With one transform
- `osc(20, 0.1, 1).kaleid(4).out(o0)` — kaleidoscope of stripes
- `noise(3).rotate(0.1, 0.05).out(o0)` — slowly rotating noise
- `voronoi(8).pixelate(40, 40).out(o0)` — chunky cells
- `osc(40, 0.1).color(0.8, 0.5, 1).out(o0)` — purple-shifted stripes
- `shape(6, 0.5).repeat(3, 3).out(o0)` — grid of hexagons
- `gradient(1).kaleid(8).out(o0)` — gradient through 8-fold mirror

## Modulation (source modulating source)
- `osc(20, 0.1).modulate(noise(3), 0.1).out(o0)` — stripes warped by noise
- `osc(40).modulateRotate(noise(2), 1, 0).out(o0)` — stripes rotated by noise
- `voronoi(6).modulate(osc(10), 0.05).out(o0)` — cells modulated by stripes
- `noise(3).modulatePixelate(osc(5), 30, 3).out(o0)` — noise pixelated by stripes

## Color / contrast tweaks
- `osc(20, 0.1).contrast(1.5).out(o0)` — high contrast stripes
- `noise(3).colorama(0.01).out(o0)` — hue cycling on noise
- `osc(40).posterize(4, 0.6).out(o0)` — banded stripes
- `voronoi(6).invert(1).out(o0)` — inverted cells

## Feedback
- `osc(20, 0.1).modulate(src(o0), 0.05).out(o0)` — light feedback warp

## Notes
- Keep transforms ≤ 3 chained. More breaks coherence.
- `osc(<freq>, <sync>, <offset>)`: freq=stripe density, sync=motion speed, offset=phase.
- `modulate(src, amount)`: amount ≈ 0.05..0.3 for tasteful, beyond ~0.5 looks chaotic.
