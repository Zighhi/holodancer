"""Six sagittal slices with the mask contour, for checking the skull strip. Usage: python diag.py <mask.npz> <out.png>"""
import sys
import numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
d = np.load(sys.argv[1]); v = d['vol']; m = d['mask']
lo, hi = np.percentile(v, [1, 99.5])
fig, ax = plt.subplots(2, 3, figsize=(15, 10), facecolor='k')
for a, x in zip(ax.flat, [30, 50, 70, 88, 110, 140]):
    a.imshow(v[x], cmap='gray', vmin=lo, vmax=hi); a.contour(m[x], levels=[.5], colors=['#ffc94d'])
    a.set_title(f'sag {x}', color='w'); a.set_yticks(range(0, 256, 20)); a.tick_params(colors='w'); a.grid(axis='y', alpha=.3)
fig.tight_layout(); fig.savefig(sys.argv[2], dpi=70, facecolor='k')
