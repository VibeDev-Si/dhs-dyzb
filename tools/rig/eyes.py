"""Eye frames (half / closed): skin-filled lids + procedural lash line, hair strands preserved."""
import numpy as np
from PIL import ImageDraw
from common import *
import faces as F


def _taper_line(d, L, pts, w0, w1, color):
    n = len(pts) - 1
    for i in range(n):
        w = w0 + (w1 - w0) * (i / max(n - 1, 1))
        d.line(L(pts[i:i + 2]), fill=color, width=max(1, int(w * F.SS)))


def eye_frame(char_rgb, kind):
    box = F.EYE_BOX; x, y, w, h = box
    crop = char_rgb[y:y + h, x:x + w].copy()
    hair = F.hair_px(crop)
    rgb_all = crop.astype(np.float32); a_all = np.zeros((h, w), np.float32)
    for E in F.EYES:
        u, v = F.local_uv(E, box); hw, hh, o = E['hw'], E['hh'], E['outer']
        uo = u * o  # >0 towards the outer corner
        ell = (u / (hw + 4)) ** 2 + (v / np.where(v < 0, hh + 7, hh + 4)) ** 2 <= 1
        core = (u / (hw * 0.8)) ** 2 + (v / (hh * 0.9)) ** 2 <= 1
        wing = (uo > hw * 0.6) & (uo < hw + 5) & (v > -hh - 4) & (v < 0) & (crop.mean(-1) < 120)
        region = ell | wing
        lid = 1.0 + 0.5 * (1 - np.clip((u / hw) ** 2, 0, 1))      # lid line sag (v units)
        if kind == 'half':
            region &= v < lid + 0.5                                 # only the upper part
        keep = cv2.morphologyEx((hair & ~core).astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)) > 0
        patch = region
        skin = F.skin_fill(crop, patch)
        im, d = F.canvas(box); L = F.Local(E['c'], E['ang'], box)
        us = np.linspace(-hw, hw, 30) * o * -1  # inner -> outer
        us = np.sort(np.linspace(-hw, hw, 30) * 1.0)[::(-1 if o < 0 else 1)]
        if kind == 'closed':
            arc = [(uu, 3.0 + 4.0 * (1 - (uu / hw) ** 2)) for uu in us]
            _taper_line(d, L, arc, 2.0, 4.0, F.LASH + (255,))
            d.line(L([arc[-1], (o * (hw + 6), -1.5)]), fill=F.LASH + (255,), width=int(2.2 * F.SS))
            d.line(L([(uu, -2.5) for uu in us[4:-6]]), fill=(200, 150, 148, 110), width=int(1.0 * F.SS))
        else:
            ln = [(uu, 0.5 - 1.2 * (1 - (uu / hw) ** 2)) for uu in us]
            _taper_line(d, L, ln, 2.2, 4.4, F.LASH + (255,))
            d.line(L([ln[-1], (o * (hw + 7), -4.5)]), fill=F.LASH + (255,), width=int(2.4 * F.SS))
            d.line(L([(uu, -6.0) for uu in us[4:-6]]), fill=(198, 146, 146, 120), width=int(1.0 * F.SS))
        drawn = F.down(im, box)
        rgb, a = F.compose(skin, patch, drawn)
        a = a * (1 - np.clip(feather(keep, 0.9) * 1.6, 0, 1))  # hair strands stay on top
        sel = a > a_all
        rgb_all[sel] = rgb[sel]; a_all = np.maximum(a_all, a)
    return rgb_all, a_all
