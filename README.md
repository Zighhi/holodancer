# holodancer

**Real-time audio-reactive holographic dancer and visuals for electronic music shows.**

A 3D dancer floating in a self-built **Pepper's ghost hologram**, dancing to whatever the DJ plays, while a projector
turns the wall above it into visuals that follow the same music. No timeline, no pre-rendered video, no operator:
everything is generated live from the audio signal, and a "director" shapes the whole night so it builds up over
hours instead of looping.

Designed and built in four weeks for a full-night trance party, where it ran from the first DJ set to sunrise.

## Highlights

- **Live music analysis in the browser.** Tempo and beat phase from an onset-strength autocorrelation on a fixed
  60 Hz grid (robust against rolling trance basslines); breakdowns, builds and drops detected from spectral *density*
  (how many of 24 bands are active relative to the track's norm); the instrument groups (kick, bass, pads, lead, hats)
  tracked as they enter, leave and change; the stereo image collapsing to mono flagged as a pre-drop cue.
  ([audio.js](app/js/audio.js), [elements.js](app/js/elements.js))
- **A dancer that listens.** A rigged character with a custom hologram shader and verlet-physics hair, choosing from a
  library of dance moves by the music's energy, retiming each move to the track's BPM and locking it to the beat; time
  echoes, beat stutters, half-time and accents on top. ([dancer.js](app/js/dancer.js), [hair.js](app/js/hair.js))
- **Generative wall visuals.** A single full-screen shader with eleven scenes and four transition styles, ~24k GPU
  particles flowing through curl noise and gathering into sacred-geometry figures, a 4D tesseract, and post-processing
  looks such as ASCII glyphs, 1-bit dither and contour lines. ([projector.js](app/js/projector.js),
  [particles.js](app/js/particles.js), [draft.js](app/js/draft.js), [tesseract.js](app/js/tesseract.js))
- **A director with memory.** Night phases by the clock, a gradual reveal of effects over the hours, rationed big
  moments, and a musical memory: a lead or bassline that returns gets the same move and colours it got before.
  ([director.js](app/js/director.js), [memory.js](app/js/memory.js))
- **Medical imaging as show material.** A pipeline from MRI DICOM data to a brain mesh, head surface and 3D texture,
  used for a brain that lights up region by region with the music and a five-minute journey through the head's
  slices. ([tools/volume](tools/volume), [brain.js](app/js/brain.js), [journey.js](app/js/journey.js))
- **Built for a live night.** Two synchronised show windows plus a control dashboard on one laptop, a launcher that
  places everything on the right screens and puts the wall back by itself when the wireless projector link drops,
  on-site calibration for the hologram and the wall, and a 60 fps budget on a mid-range laptop GPU.
  ([link.js](app/js/link.js), [calib.js](app/js/calib.js), [start-show.ps1](app/start-show.ps1))

## Architecture

```
DJ mixer -> audio interface --USB--> laptop
                                      |  hologram.html   master: audio analysis, director, memory, the dancer
                                      |      | BroadcastChannel: music state every frame + show events
                                      |  projector.html  the wall          dashboard.html  control + monitoring
                                      |- HDMI -> eDP controller board -> bare laptop panel -> Pepper's ghost
                                      '- Miracast -> projector -> the wall
```

A local web app in plain JavaScript modules and three.js, no build step, served by a small Python server that also
stores the show's memory and calibration. Details in [docs/how-it-works.md](docs/how-it-works.md).

## The hologram

A bare 15.6" laptop panel on an HDMI-to-eDP controller board hangs face-down under the roof of a shelf cube; a 2 mm
acrylic sheet at 24 degrees below it reflects the picture towards the crowd. Because the audience looks down into the
cube, they only ever see the reflection: the dancer floating in a black void. The geometry was chosen with ray-traced
viewer simulations, comparing it with a Pepper's cone. ([optics/](optics), [docs/hardware.md](docs/hardware.md))

## Tech

JavaScript (ES modules), three.js / WebGL2 with custom GLSL shaders, Web Audio API, BroadcastChannel; Python for the
local server, the optics simulations (NumPy, Matplotlib) and the imaging pipeline (pydicom, SciPy, scikit-image,
trimesh); PowerShell + Win32 for the show launcher.

## Repository

| Folder | |
|---|---|
| [app/](app) | the show: pages, modules, local server, launcher |
| [optics/](optics) | Pepper's ghost / Pepper's cone geometry, viewer simulations, build drawings |
| [tools/volume/](tools/volume) | MRI (DICOM) -> meshes and 3D textures |
| [docs/](docs) | [how it works](docs/how-it-works.md), [hardware](docs/hardware.md), [running a show](docs/running-a-show.md) |

Not included: the dancer character and animations (Mixamo, which may not be redistributed) and any medical data; see
[app/assets](app/assets/README.md). Running it: `python app/serve.py`, or `app\start-show.ps1` for the full show.

## Credits

[three.js](https://threejs.org) (MIT), character and animations from [Mixamo](https://www.mixamo.com), drafting looks
inspired by [GEOMETRIC](https://geometric-art.com), Pepper's cone after Luo, Lawrence and Seitz, UIST 2017
([paper](https://dl.acm.org/doi/10.1145/3126594.3126602)).

[MIT](LICENSE) © 2026 Zighi
