# tools/volume: an MRI as show material (optional)

Turns your own MRI scan (DICOM) into what the show's optional volume features use: a brain mesh that lights up with
the music, a head surface and 3D texture for the head journey and the wall's MRI scenes, and spine slices. Without
these files the show simply skips those features.

**Privacy:** an MRI is medical data, and a head scan contains a face. The scripts read only pixel data and geometry
(no names, IDs or dates are printed or kept), and everything they write goes to folders that `.gitignore` excludes
(`work/`, `app/assets/brain/`, `app/assets/spine/`). Keep it that way: never commit or publish the scans or anything
made from them.

## Setup
```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Brain and head (from a T1-weighted 3D series)
```
python inspect_series.py <dicom folder>                                 # list the series (technical fields only)
python load_volume.py <dicom folder> <series no> work/t1.npz work/t1.png  # one series -> a volume with real spacing
python skullstrip.py work/t1.npz work/brain.npz work/strip.png          # BET: keep the brain
python refine_mask.py work/brain.npz work/brain_clean.npz work/clean.png  # cut leaks into the neck / face
python diag.py work/brain_clean.npz work/diag.png                       # check the mask on six slices
python make_mesh.py work/brain_clean.npz work/t1.npz ../../app/assets/brain/brain.glb work/mesh.png
python make_head.py work/brain_clean.npz ../../app/assets/brain work/head.png
python render_preview.py ../../app/assets/brain/brain.glb work/folds.png  # check the folds
```
`make_mesh.py` writes `brain.glb` (cortex + white matter, vertex colour = sulcal depth) and `frame.json` (the brain's
frame); `make_head.py` then builds `head.glb` and `head_volume.bin/.json` in that same frame.

## Spine (optional, from sagittal / coronal T2 series)
```
python make_spine.py <spine dicom folder> ../../app/assets/spine work/spine
```
The series names it looks for (`t2_tse_sag_COMP`, ...) come from one scanner's protocol; adjust them to yours
(`inspect_series.py` lists them).
