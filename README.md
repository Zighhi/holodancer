# holodancer

Real-time audio-reactive holographic dancer and visuals for electronic music shows.

A rigged 3D dancer floats in a **Pepper's ghost hologram** and dances to whatever the DJ plays, while a
**projector** fills the wall above it with visuals that follow the same music. Everything reacts live: tempo and beat,
breakdowns, builds and drops, which instruments come in or drop out. A director shapes the whole night, so the show
builds up over hours instead of repeating itself.

It runs as a local web app (three.js, plain JavaScript modules, no build step) on one laptop, with a small Python
server, and was first used for a full-night trance party, where it ran unattended from setup to sunrise.

## What it does

- **Music analysis** ([app/js/audio.js](app/js/audio.js), [app/js/elements.js](app/js/elements.js)):
  tempo and beat phase from an onset-strength autocorrelation; sections (breakdown, build, drop, peak, silence) from
  how many of 24 frequency bands are "playing"; the instrument groups (kick, bass, pads, lead, hats) entering, leaving
  and changing; stereo width (the mix collapsing to mono before a drop).
- **The hologram** ([app/js/hologram.js](app/js/hologram.js), [app/js/dancer.js](app/js/dancer.js)): a rigged
  character with a rim-glow hologram material and verlet-physics hair, picking dance moves by the music's energy and
  locking them to the beat; time echoes, stutters, half-time, accents, trails, kaleidoscope and bloom on top.
- **The wall** ([app/js/projector.js](app/js/projector.js)): its own scenes (tunnel, mandala, flow, swarm of GPU
  particles that gather into sacred-geometry figures, a 4D tesseract, waves, halo ...), crossfading on phrases with
  several transition styles, and looks (mirrors, video echoes, time bands, CRT, ASCII glyphs / 1-bit dither /
  contour "drafting" looks). The dancer can travel up from the hologram onto the wall and back.
- **Director + memory** ([app/js/director.js](app/js/director.js), [app/js/memory.js](app/js/memory.js)): night
  phases by the clock, a gradual reveal of the effects over the night, rationed big moments, and a musical memory:
  a returning lead or bassline gets the same move and colours again.
- **Calibration** ([app/js/calib.js](app/js/calib.js)): a test pattern and keys (or dashboard buttons) to flip, rotate,
  scale, stretch, keystone and move each screen's picture until it looks right in the acrylic / on the wall.
- **Dashboard** ([app/dashboard.html](app/dashboard.html)): live thumbnails of both screens, the music state, buttons
  for every moment, calibration, audio input picker, a test-track player.
- **Optional: medical volumes.** Given your own MRI (DICOM), [tools/volume](tools/volume) builds a brain mesh, a head
  surface and a 3D texture; the show then adds a brain that lights up with the music, a journey through the head's
  slices, and MRI scenes on the wall. Without that data the show simply skips them. No scans are included.

## How the pieces fit

```
DJ mixer -> audio interface --USB--> laptop
                                      |  hologram.html  (master: audio analysis, director, the dancer)
                                      |      | BroadcastChannel: music state every frame + events
                                      |  projector.html (the wall)        dashboard.html (laptop screen)
                                      |- HDMI -> eDP controller board -> bare laptop panel -> Pepper's ghost
                                      '- Miracast / HDMI -> projector -> the wall
```

More in [docs/how-it-works.md](docs/how-it-works.md).

## Quick start

1. **Python 3** and a **Chromium-based browser** (ungoogled-chromium, Chromium or Chrome).
2. **A dancer:** download a rigged character and some dance animations from Mixamo (free Adobe account) into
   `app/assets/dancers/`, see [app/assets/README.md](app/assets/README.md). They are not in the repo: Mixamo files may
   not be redistributed.
3. Try it on one screen:
   ```
   cd app
   python serve.py            # opens hologram.html; also try projector.html, dashboard.html, audio-test.html
   ```
   Click **Audio file** to drive it with a track, or **Start input** for a live input.
4. The full show (Windows, PowerShell), with the panel and the projector connected and set to *Extend*:
   ```
   .\start-show.ps1            # server + hologram and wall fullscreen on their screens + the dashboard
   .\start-show.ps1 -Desk      # testing: all three windows side by side on the laptop screen
   .\start-show.ps1 -WallOnly  # only the projector connected
   ```
   Then calibrate each screen from the dashboard. See [docs/running-a-show.md](docs/running-a-show.md).

## The hardware

A bare 15.6" laptop panel on an HDMI-to-eDP controller board hangs face-down under the roof of a shelf cube; a 2 mm
clear acrylic sheet at 24 degrees below it reflects the picture towards the crowd, who look down into the cube and
only ever see the reflection: the dancer floating in a black void. Parts, measurements, the build and the projector
link are in [docs/hardware.md](docs/hardware.md); the optics simulations and build drawings are in [optics/](optics).

## Folders

| Folder | What |
|---|---|
| [app/](app) | the show: pages, `js/`, `serve.py`, `start-show.ps1`, `vendor/three` (three.js r170, MIT) |
| [app/assets/](app/assets) | your dancer (Mixamo) and optional volumes; only `moves.json` (the move pools) is in the repo |
| [optics/](optics) | Pepper's ghost / Pepper's cone geometry, ray-traced viewer simulations, build drawings |
| [tools/volume/](tools/volume) | optional: MRI (DICOM) -> brain mesh, head surface, 3D texture for the show |
| [docs/](docs) | how it works, hardware, running a show |

## Credits

- [three.js](https://threejs.org) (MIT), vendored in `app/vendor/three`.
- Characters and animations: [Mixamo](https://www.mixamo.com) (bring your own).
- The drafting looks are inspired by [GEOMETRIC](https://geometric-art.com).
- Pepper's cone geometry after Luo, Lawrence, Seitz: *Pepper's Cone: An Inexpensive Do-It-Yourself 3D Display*,
  UIST 2017 ([ACM](https://dl.acm.org/doi/10.1145/3126594.3126602)).

## License

[MIT](LICENSE) © 2026 Zighi
