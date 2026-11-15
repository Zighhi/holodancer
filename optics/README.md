# optics: Pepper's ghost and Pepper's cone in a shelf cube

Geometry studies, ray-traced viewer simulations and build drawings for putting a hologram into one cube of a shelf
(the reference: an IKEA KALLAX top-row cube, inside 335 x 335 x 382 mm, crowd 1-2 m away looking down 27-43 degrees).
All numbers in mm; the measured values are at the top of each script, change them for your own space.

| Script | Makes |
|---|---|
| [simulate_ghost.py](simulate_ghost.py) | the classic Pepper's ghost (panel face-down under the roof, flat sheet below it): side view + what viewers see from several positions -> `diagrams/8-ghost-side.png`, `9-ghost-sim.png` |
| [ghost_build.py](ghost_build.py) | the build drawing: where to mark the 24-degree line on the side walls -> `diagrams/10-ghost-build.png` |
| [cone_kallax_study.py](cone_kallax_study.py) | the Pepper's cone variant: cone angle vs viewing angle, image size |
| [diagrams.py](diagrams.py) | the cone's dimension drawings and flat cutting pattern -> `diagrams/1-5` |
| [simulate_view.py](simulate_view.py) | traces viewer rays through the cone to the panel: the image to draw and what viewers see -> `diagrams/6-7` |

```
pip install -r requirements.txt
python simulate_ghost.py
```

The result for the front-only setup was the classic ghost (bigger image, the screen never visible, no warping); see
[docs/hardware.md](../docs/hardware.md). The cone (after Luo, Lawrence, Seitz, *Pepper's Cone*, UIST 2017) is the
option for 360-degree setups.
