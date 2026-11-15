# Assets

Nothing here is in the repo except `dancers/moves.json`. Bring your own files; `.gitignore` keeps them out.

## The dancer (required)

From [Mixamo](https://www.mixamo.com) (free Adobe account). Mixamo's terms allow using the characters and animations
in your own projects, but not sharing the files themselves, so every user downloads their own.

1. **Character:** pick a character, download it as **FBX Binary, "With Skin"**, T-pose. Put the `.fbx` directly into
   `app/assets/dancers/`. (A rigged `.glb` works too.)
2. **Moves:** for each dance you like, select the same character, open the animation, download it as
   **FBX Binary, "Without Skin"**, 30 fps, and put it into `app/assets/dancers/moves/`. 10-20 moves of different
   energy work well (slow / sensual ones for breakdowns, hard ones for drops).
3. `serve.py` lists them for the show (`/api/dancers`). The dancer measures each move's own tempo and locks it to the
   music's beat.

### Move pools: `dancers/moves.json`

Which moves the dancer picks for each moment: `breakdown`, `build`, `drop`, `peak`, `normal`. Names are the file names
in `moves/` without `.fbx`; a move can be in several pools. Moves not listed anywhere are sorted in automatically by how
energetic they are. The file in the repo lists the moves the first show used, as an example.

## Optional: medical volumes

Made by [tools/volume](../../tools/volume) from your own MRI. The show uses them when present and skips them otherwise.

| Folder | Files | Used for |
|---|---|---|
| `brain/` | `brain.glb`, `frame.json` | the brain in the hologram and on the wall (lights up with the music, point cloud) |
| `brain/` | `head.glb`, `head_volume.bin/.json` | the head journey (face -> cut -> slices), the wall's MRI scenes (kaleidoscope, scanner, lightbox) |
| `spine/` | `spine_sag.*`, `spine_cor.*`, `cord.json` | the spine stack (hologram) and the kundalini scene (wall) |

These are medical data: keep them on your machine. `.gitignore` already excludes `brain/` and `spine/`.
