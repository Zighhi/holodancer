# How it works

## Windows and roles

The show is three pages from the same local server ([app/serve.py](../app/serve.py)), opened by
[start-show.ps1](../app/start-show.ps1) as Chromium app windows with their own profile (background throttling off,
microphone allowed):

| Page | Role |
|---|---|
| `hologram.html` | **the master**: audio input + analysis, the director, the musical memory, the dancer in the cube |
| `projector.html` | the wall: no audio of its own; follows the master's music state (runs alone at a fake tempo until the master is open) |
| `dashboard.html` | the laptop screen: thumbnails + info lines of both windows, buttons, calibration, audio input, a test-track player |

They talk over a `BroadcastChannel` ([app/js/link.js](../app/js/link.js)): the master sends the music state every
frame (tempo, beat phase, section, intensity, element levels, the night phase, what is happening) plus every event
(drops, rises, phrases, sections, colour changes, the dancer moving between the screens). Each show window reports a
small thumbnail and its info line to the dashboard twice a second; the dashboard sends keys and commands back.
Nothing leaves the laptop.

The server also stores the show's memory (`/api/memory` -> `app/memory/memory.json`), the screens' calibration
(`/api/calib` -> `calib.json`) and lists the dancer files (`/api/dancers`).

## Music analysis

[app/js/audio.js](../app/js/audio.js) runs on the master every frame:

- **Tempo and beat:** an onset-strength curve (log spectral flux, weighted towards the kick range) is resampled onto a
  fixed 60 Hz grid; its autocorrelation, scored at 1-4 beat lags, gives the tempo (robust against rolling
  basslines), and the beat phase is the grid offset that best matches the curve.
- **Sections:** *density*, how many of 24 frequency bands are "playing" (loud for that band *and* moving), relative to
  the track's normal density: breakdowns thin out, builds add elements back, drops jump back to full. Plus peaks,
  silences and an overall intensity.
- **Elements** ([app/js/elements.js](../app/js/elements.js)): which instrument groups are playing (kick, bass, pads,
  lead, hats) and when they enter, exit or change pattern; phrase boundaries (several things change at once); the
  stereo field, including the mix collapsing to mono before a drop (`predrop`).

[app/audio-test.html](../app/audio-test.html) shows all of it as meters.

## Director and memory

[app/js/director.js](../app/js/director.js) shapes the night:

- **Phases by the clock** (`PHASES`, from `NIGHT_START`): arrival, warm-up, immersion, peak, late night. Each sets how
  far the visuals may go (trip level, full-screen effects, how often the big moments come).
- **Gradual reveal** (`UNLOCK`): what appears from which phase on, so the night keeps opening up; a first appearance
  is preferred when something unlocks.
- **Variety:** `pick()` weighs choices by how recently they were used tonight; big effects are rationed. All of it
  survives a reload (stored in the memory file under `night`).

[app/js/memory.js](../app/js/memory.js) keeps a library of motifs: 2-bar fingerprints of each instrument group and
what the show did with them, so a returning lead or bassline gets the same move and colours again.

## The hologram

[app/js/hologram.js](../app/js/hologram.js) + [app/js/dancer.js](../app/js/dancer.js):

- A rigged character (Mixamo FBX or glTF) in a hologram material: a dark body with a palette glow and a two-tone rim,
  bright on pure black because the Pepper's ghost only shows light. [hair.js](../app/js/hair.js): verlet strands
  colliding with her head and shoulders. [whip.js](../app/js/whip.js): a ribbon in her hand.
- Moves come from pools per section ([assets/dancers/moves.json](../app/assets/dancers/moves.json)); each move's own
  tempo is measured and locked to the beat; moves crossfade on phrases.
- Layers driven by one "trip" level ([psy.js](../app/js/psy.js)): feedback trails, a kaleidoscope / warp / RGB-split
  pass, a fractal mandala backdrop, wireframe orbiters; time echoes, stutters, accents, half-time.
- Mind moments in breakdowns: the tesseract ([tesseract.js](../app/js/tesseract.js)), or with the optional volumes
  the brain ([brain.js](../app/js/brain.js)), the head journey ([journey.js](../app/js/journey.js),
  [head.js](../app/js/head.js)) and the spine stack ([spine.js](../app/js/spine.js)).

## The wall

[app/js/projector.js](../app/js/projector.js): continuous visuals that never stop and complement the hologram instead
of copying it.

- **Scenes** in one full-screen shader (tunnel, mandala, flow, halo, waves, swarm, hyper, plus the volume scenes when
  the data is there), crossfading on phrases with four transition styles (portal, dissolve, scan, spiral).
  [particles.js](../app/js/particles.js): ~24k GPU particles along a curl-noise flow that gather into figures (flower
  of life, golden spiral, hexagram, the tesseract) on phrases.
- **Looks** over the scene: mirror, video echoes, time bands, CRT, and the drafting looks
  ([draft.js](../app/js/draft.js)): ASCII glyphs by brightness, 1-bit dither, contour lines, on the whole wall or only
  on the elements (the dancer, the tesseract ...).
- **The dancer on the wall:** she can leave the cube, rise up the wall and dance there (or on both screens in unison).
- **Memories of the night:** snapshots of the big moments come back late in the night as films and ghosts.

## Calibration

[app/js/calib.js](../app/js/calib.js) is the last post-processing pass of each window: flip, quarter-turn rotation
(in real proportions), scale, stretch, keystone and offset, with a test pattern (grid, circle, labels, black-level
steps). The wall's version also stores where the cube is, so things rise out of the cube from the right place.

## Performance

60 fps frame cap, no antialiasing, half-size bloom, the wall rendered at 720 lines, hair physics ~3 ms, particles
fully on the GPU. Long shader functions are called a minimum number of times and samplers are never chosen in branches,
because the Direct3D shader compiler (ANGLE) can hang on them.

## Making it your own

A different show mostly means a different look, not a different engine: the palettes and looks (top of
[dancer.js](../app/js/dancer.js), [psy.js](../app/js/psy.js)), the wall's scenes and their weights per section
(`SECTION_SCENES` in [projector.js](../app/js/projector.js)), the night's phases and reveal
([director.js](../app/js/director.js)), and the dancer and her moves ([assets](../app/assets/README.md)).
