# Running a show

## The day before
- Laptop: pause Windows Update, *Do not disturb* on, power mode *Best performance*, screen / sleep when plugged in:
  *Never*. Taskbar: "Show my taskbar on all displays" off.
- Pack: panel + board + eDP cable + 12 V adapter (and the backup pair), HDMI cable, acrylic + a spare, velcro + gaffer
  tape, black felt / cloth, the audio interface + USB cable, laptop charger, power strip.

## Setup (in this order)
1. **Laptop plugged in** (it runs on battery, but not for a whole night).
2. Hologram: eDP cable board <-> panel, HDMI board <-> laptop, **12 V last**. Never touch the eDP cable while powered.
3. Projector: open its screen-mirroring app; on the laptop **Win+K** -> the projector.
4. Windows display settings: **Extend**; order **laptop | panel | projector** (or use `-Swap`); panel at 100 % scale.
   Check the sound output is not the projector.
5. The audio interface into USB, the mixer's booth / record output into it.

## Start
```
cd app
.\start-show.ps1
```
Three windows open: the **hologram** (panel), the **wall** (projector) and the **dashboard** on the laptop screen
(live thumbnails, the music, buttons for every moment, calibration, a key pad that sends keys to either window).
Keep the script's console window open: it watches the screens and fixes the windows after a projector drop.

| Option | |
|---|---|
| `-Desk` | testing without the panel and projector: all three windows side by side on the laptop screen |
| `-WallOnly` | only the projector connected: wall fullscreen, hologram + dashboard on the laptop screen |
| `-WallFps 30` | the wall at 30 fps (half the work; Miracast hardly shows more) |
| `-Reposition` | the show runs but a window moved: put the windows back, nothing new starts |
| `-Swap` | the projector is left of the panel in the display order |
| `-NoServer`, `-Port 8080`, `-NoWatch`, `-Chrome <path>` | |

The hologram starts listening to the interface by itself (it looks for SSL / UFO / "USB Audio CODEC" inputs); else pick
the input at the top of the dashboard. Its info line shows **BPM** and what is playing. For a test without the mixer,
use the dashboard's **audio file** button.

The night phases follow the **clock** (see `PHASES` and `NIGHT_START` in [app/js/director.js](../app/js/director.js)),
and the effects reveal themselves over the night (`UNLOCK`). Nothing to press. **O** on the hologram tries the phases
early; **Shift+O** clears the history of test runs, so the night starts fresh.

## Calibration (once per setup)
On the dashboard: **Calibration on / off** in each screen's card (or **R** in that window). It saves when closed.

| Key | Dashboard | |
|---|---|---|
| T | Test pattern / show | switch between the test pattern and the live show |
| arrows (Shift = big steps) | move / fast | move the picture |
| + / - | Bigger / Smaller | size |
| W / S | Taller / Shorter | stretch |
| Q / E | Top narrower / wider | keystone |
| X / Y | Flip | flip left-right / upside down (both = 180 degrees) |
| O | Rotate 90° | a quarter turn clockwise per press (a panel mounted turned); then fit the size |
| C + arrows | | (wall) move the CUBE marker to where the cube is: things rise out of the cube from there |
| 0 | Reset | back to the defaults |

The circle must look round from where the crowd stands; TOP must read at the top, LEFT on the crowd's left.

## Hologram keys (optional: it runs by itself)
| Key | | Key | |
|---|---|---|---|
| V | send her up to the wall / back down | Q | unison: on both screens for 8 bars |
| D | fake drop | N | next move |
| C | next colours | X | scene: auto / solo / echoes / tunnel / full |
| P | trip level: auto / high / low | S | stutter: auto / on / off |
| K | kaleidoscope: auto / on / off | T | half-time |
| 1-5 | move pools (breakdown, build, drop, peak, normal) | A | accent styles |
| L | hair on / off, **[ ]** hair dimmer / brighter | M | mirror |
| I | drafting look: glyphs / dither / contours / auto | Shift+I | tesseract (mind moment) |
| H | look hologram <-> projector (leave it on hologram) | U | hide the info |
| O | try the night phases (Shift+O: clear the history) | F | fullscreen |
| B / Shift+B, J, Z, Y, E, Shift+S | brain, head journey, snippet, scanner, echo slices, spine stack (need the optional volumes) | | |

## Wall keys
S next scene, L next look, G drafting look (glyphs / dither / contours / auto), Shift+G drafting only on the elements /
whole wall / auto, V dancer auto / on / off, K kaleidoscope, M mirror (rear projection), I alone mode, U hide the info.
Test pages: `projector.html?test=swarm|forms|hyper|glyphs|dither|contours|element|text|memories|trans` (`&scene=name`
holds one scene), `hologram.html?test=hyper|glyphs|dither|contours`.

## If something goes wrong
| What | Do |
|---|---|
| A window is black or frozen | click it, **Ctrl+R** (the hologram restarts the audio itself) |
| A window moved to the wrong screen | `.\start-show.ps1 -Reposition` |
| The projector dropped out (wall frozen) | Win+K -> the projector. The script switches to Extend and puts the wall back by itself; if not: Win+P -> Extend, then `-Reposition` |
| No reaction to the music | info line says "no audio"? Check the interface and its cable, then Ctrl+R in the hologram |
| Everything is a mess | close both show windows (Alt+F4), `.\start-show.ps1 -NoServer` |
| The server's console window was closed | `.\start-show.ps1` (without `-NoServer`) |
| Choppy | laptop plugged in? *Best performance*? Then restart with `-WallFps 30` |
| The panel shows nothing | 12 V off, check the eDP cable seating, 12 V on; else swap to the backup pair |

## After the show
`app/memory/memory.json` holds what the show learned (motifs, the night's history) and `calib.json` the venue's
calibration. Delete `memory.json` for a fresh start at the next show; keep `calib.json` if the setup stays the same.
