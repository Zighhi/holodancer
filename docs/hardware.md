# Hardware

The reference build: one laptop, a bare laptop panel as a Pepper's ghost in a shelf cube, and a small projector on
the wall above it. Everything here was built and used for a full night; the numbers are from that build.

## Signal chain

```
DJ mixer -> USB audio interface --USB--> laptop (analysis + rendering, 2 show windows in Chromium)
                                           |- HDMI ---------------> HDMI-to-eDP board -> 15.6" panel -> hologram
                                           '- Miracast (or HDMI) --> projector -> the wall
```

- **Laptop:** any machine with a dedicated GPU is comfortable. Reference: Ryzen 5 5600H + RTX 3050 laptop. Both show
  windows at 60 fps used ~32 % of the GPU (~15 % with the wall at 30 fps), even on battery. Set the browser to the
  *High performance* GPU in Windows' graphics settings.
- **Audio:** any USB interface fed from the mixer's booth / record output (tested: SSL 2, Behringer UFO202). The
  hologram window picks the interface by itself (`?autostart`), or from the dashboard.

## The panel

A 15.6" 1920x1080 laptop panel (eDP 30-pin, e.g. Innolux N156HGA-EAL / -EAB), still in its laptop lid, driven by an
**HDMI/VGA-to-eDP 30-pin controller board kit** made for that exact panel model (the boards are panel-specific).

- Power: **12 V DC, at least 2 A**, plug **5.5 x 2.5 mm, centre positive**. Check the adapter's polarity with a
  multimeter before the first connection. Panel voltage on the board: 3.3 V.
- **Never plug or unplug the eDP cable while the board is powered.** Connect everything, then plug in the 12 V
  (hot-plugging can kill the panel's or the board's driver).
- Board menu: backlight 100, dynamic contrast off, input fixed to HDMI, no-signal background black.
- A second panel + board pair is a good backup for a show.

## The hologram: classic Pepper's ghost

Drawings: [optics/diagrams](../optics/diagrams) 8-10 ([simulate_ghost.py](../optics/simulate_ghost.py),
[ghost_build.py](../optics/ghost_build.py)).

The reference venue: an IKEA KALLAX lying on its side with the DJ gear on top; the hologram sits in a **top-row cube**
(inside 335 wide x 335 high x 382 deep, open front and back, cube floor 390 mm above the ground). The crowd stands
1-2 m in front, eyes ~1.55-1.70 m, so people look **down** into the cube at ~27-43 degrees.

- **Panel:** the lid hangs **face-down under the cube's roof**, hinge edge towards the back, lid front flush with the
  opening. Mount it on the back of the lid only (never the screen): **velcro / Dual Lock** strips (removable, and it
  goes back in the same place, so the calibration stays right) plus gaffer tape as a backup. Avoid foam mounting
  tape: it is very hard to remove.
- **Sheet:** flat **2 mm clear acrylic, 330 x 400 mm** (cut to the cube width), at **24 degrees** from horizontal,
  rising towards the back: front edge 10 mm above the floor, ~5 mm behind the opening. Mark the line on both side
  walls (depth from the opening -> height: 5 -> 10, 100 -> 52, 200 -> 97, 300 -> 141, 382 -> 178 mm), tape each side
  edge to its wall with gaffer L-strips and tape the front edge to the floor as a hinge. Check the angle with a phone
  level app (+-2 degrees is fine).
- **Why it works:** the crowd looks down, so it never sees the downward-facing screen, only its reflection. The image
  is large (~19 x 19-33 cm visible from 1-2 m), undistorted from the side, and needs only a flip and a perspective
  correction in software (the calibration).
- **Brightness:** the reflection is ~9 % of the panel's brightness (~20-25 nits): bright content on pure black, panel
  at full brightness, no stage light into the cube.
- **Black, matte surroundings:** ~90 % of the panel's light passes through the sheet onto the cube floor, which the
  crowd sees through the sheet. Semi-gloss laminate shows a glowing patch or a second image, so put **matte black
  felt** on the floor under the sheet and black fabric over the open back.
- Clean the acrylic only with water, a drop of dish soap and a microfibre cloth (alcohol and solvents cloud it).

### Alternative: Pepper's cone (360 degrees)

Studied with [cone_kallax_study.py](../optics/cone_kallax_study.py), [diagrams.py](../optics/diagrams.py) and
[simulate_view.py](../optics/simulate_view.py) (diagrams 1-7), not used for the front-only setup:

- The best cone angle follows the viewing angle: **theta ~ 45 degrees - beta / 2** (beta = how far people look down).
  At eye level that is the paper's 45 degree cone; looking down 27-43 degrees needs a ~30 degree cone.
- In a cube this size its image is small (~10 x 13 cm), and the crowd sees the screen directly through the clear cone
  (a bright smeared copy, ~10x brighter than the hologram) unless a louvered privacy filter is used.
- Its strength is rotational symmetry: a centred cone with ring-shaped content works from all sides, so it is worth
  it for a 360-degree setup.

## The projector

Reference: an HY300-class Android mini projector (1280x720), ~1 m above the shelf.

- **Miracast** works without any router: Win+K on the laptop, the projector's screen-mirroring app on the other end,
  *Extend* (Win+P). Both devices keep Wi-Fi **on** but **not connected to any network**; a projector joined to a home
  network may not show up in Win+K. Keep the laptop plugged in and close to the projector.
- Miracast can drop now and then. `start-show.ps1` keeps watching the screens: after a drop, Win+K -> the projector is
  enough; it switches back to Extend and puts the wall window back fullscreen by itself.
- The wall renders at 720 lines (`?res=full` for the window's own size); `-WallFps 30` halves its work.
- An HDMI cable (from a second video output) is the drop-proof option when the layout allows it.
