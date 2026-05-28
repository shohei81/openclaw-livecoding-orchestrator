# Drum snippet bank

Short, single-line drum patterns you can stack together. Pick 2–3 layers and combine via `stack(...)`. Tweak gain / pan / effects sparingly.

## Kicks
- `s("bd")` — one kick per cycle, very sparse
- `s("bd ~ ~ ~")` — kick on the 1, three rests (downbeat anchor)
- `s("bd*2")` — kick on 1 and 3 (the four-on-the-floor half-feel)
- `s("bd ~ bd ~")` — kick on 1 and 3, explicit
- `s("bd*4")` — four-on-the-floor
- `s("bd(3,8)")` — three kicks spread Euclidean over 8 slots
- `s("bd(5,8)")` — five-against-eight pattern
- `s("bd ~ bd bd ~ ~ bd ~")` — broken kick pattern

## Snares / claps
- `s("~ sd ~ sd")` — classic backbeat
- `s("~ cp ~ cp")` — clap backbeat
- `s("~ ~ sd ~")` — single offbeat snare
- `s("~ sd").every(4, x => x.fast(2))` — backbeat that doubles up every 4 cycles
- `s("sd").struct("0 1 0 1")` — snare on 2 and 4 via struct

## Hats
- `s("hh*8").gain(0.5)` — straight eighths, quiet
- `s("hh*4")` — quarter notes
- `s("hh ~ hh ~ hh ~ hh hh")` — galloping hat
- `s("hh*8").gain("<0.4 0.7>")` — accent every other
- `s("hh(5,8)").gain(0.5)` — Euclidean hats
- `s("oh*2").gain(0.4)` — sparse open hats

## Percussion / texture
- `s("cb")` — single cowbell
- `s("rim*2").gain(0.4)` — rimshot pulse
- `s("cp/2")` — clap held over two cycles

## Multi-bar / variation (use these to avoid monotony)
- `s("bd*2").every(4, x => x.fast(2))` — locked kick, doubles every 4 bars
- `s("bd ~ bd ~").every(2, x => x.rev())` — kick reverses every other bar
- `s("hh*8").every(4, x => x.gain(0.2))` — hats briefly drop volume every 4 bars
- `cat(s("bd*2"), s("bd*4"))` — two-bar phrase: half then four
- `s("bd*2").slow(2)` — half-tempo kick (a kick every 2 bars)
- `s("~ sd ~ sd").fast(2)` — double-time snare backbeat
