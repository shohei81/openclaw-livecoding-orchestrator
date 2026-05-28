# Lead snippet bank

Short lead phrases in A minor (the default key). One line each. Stay above C4. Pick and modify (transpose octave, change wave, add space).

## Arpeggios
- `note("a4 c5 e5 g5").s("sawtooth").lpf(2000)` — A minor 7 arpeggio
- `note("c5 e5 g5 a5").s("sawtooth").lpf(2000)` — voicing variation
- `note("e5 g5 a5 c6").s("triangle").lpf(2200)` — higher voicing
- `note("<a4 c5 e5 g5>*2").s("square").lpf(1800)` — angle-bracket cycle through

## Held melodic notes
- `note("a4").s("triangle").lpf(2000).room(0.4)` — single sustained note
- `note("<a4 c5 e5>/2").s("triangle").lpf(1800).room(0.4)` — slowly cycling notes
- `note("e5/4").s("sine").gain(0.6)` — pure sine held four cycles

## Phrases (call/answer)
- `note("a4 ~ c5 ~").s("sawtooth").lpf(1800)` — sparse call
- `note("~ ~ e5 c5").s("sawtooth").lpf(1800)` — sparse answer
- `note("a4 c5 e5 ~").s("triangle").lpf(2000).delay(0.4)` — ascending then space
- `note("<a4 c5 e5 c5>").s("square").lpf(2000).gain(0.6)` — winding phrase

## With space / FX
- `note("a4").s("sawtooth").lpf(1500).delay(0.5).room(0.6)` — single note, ambient
- `note("a4 c5").s("triangle").lpf(2000).delay(0.3).every(3, x => x.rev())` — phrase that reverses
- `note("~ ~ ~ <a4 c5 e5>").s("sawtooth").lpf(2000).delay(0.4)` — late phrase

## Counterpoint / faster
- `note("a4 c5 e5 g5 c5 a4").s("triangle").lpf(2200).fast(2)` — running line
- `note("<a4 e4>*4").s("square").lpf(1600).gain(0.5)` — chattering octave figure

## Multi-bar / variation (use these to avoid monotony)
- `note("<a4 c5 e5 g5>").s("triangle").lpf(2000).slow(2)` — single note held 2 cycles, cycle changes
- `cat(note("a4 c5"), note("e5 g5"))` — two-bar phrase: low pair then high pair
- `note("a4 ~ c5 ~").s("sawtooth").lpf(1800).every(4, x => x.fast(2))` — sparse line, runs every 4 bars
- `note("<a4 c5 e5>").s("triangle").lpf(2000).every(3, x => x.rev())` — phrase reverses every 3 cycles

## Texture
- swap `.s("sawtooth")` for `.s("square")` or `.s("triangle")` for different brightness
- `.delay(0.3..0.6)` adds tail; `.room(0.3..0.6)` adds space; combine sparingly
