"""Procedural mouth / eye frames drawn over inpainted skin patches."""
import numpy as np
import cv2
from PIL import Image, ImageDraw
from common import *

SS = 4  # supersampling
MOUTH = dict(c=(556.0, 409.5), ang=-20.0, half=24.0, box=(512, 380, 92, 64))
LINE_RGB = (148, 72, 78)
EYES = [  # centre, angle (deg, image coords), half-width, half-height of opening
    dict(c=(484.0, 359.5), ang=-12.0, hw=31.0, hh=10.5, outer=-1),   # screen-left eye
    dict(c=(588.0, 321.5), ang=-19.0, hw=35.0, hh=10.5, outer=+1),
]
EYE_BOX = (432, 276, 206, 120)
LASH = (38, 28, 46)


class Local:
    """local frame (u along feature axis, v down) -> supersampled box coords"""
    def __init__(s, c, ang, box):
        s.c, s.box = c, box
        r = np.deg2rad(ang); s.ca, s.sa = np.cos(r), np.sin(r)

    def __call__(s, pts):
        out = []
        for u, v in pts:
            x = s.c[0] + u * s.ca - v * s.sa - s.box[0]
            y = s.c[1] + u * s.sa + v * s.ca - s.box[1]
            out.append((x * SS, y * SS))
        return out


def canvas(box):
    im = Image.new('RGBA', (box[2] * SS, box[3] * SS), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def down(im, box):
    return np.array(im.resize((box[2], box[3]), Image.LANCZOS)).astype(np.float32) / 255.0


def skin_patch(char_rgb, box, mask):
    """inpaint `mask` (box-local bool) in the character crop -> clean skin."""
    x, y, w, h = box
    crop = np.ascontiguousarray(char_rgb[y:y + h, x:x + w])
    return cv2.inpaint(crop, mask.astype(np.uint8), 5, cv2.INPAINT_TELEA)


def compose(skin, patch_mask, drawn):
    """frame = drawn RGBA over skin, alpha = max(feathered patch, drawn alpha)."""
    pa = feather(patch_mask, 1.6)
    pa[erode(patch_mask, 2)] = 1
    da = drawn[..., 3:4]
    rgb = skin.astype(np.float32) * (1 - da) + drawn[..., :3] * 255 * da
    a = np.maximum(pa, da[..., 0])
    return rgb, a


def lens(u0, top, bot, n=40, cy=0.0):
    """closed mouth outline: upper curve (v<0) then lower curve, local coords"""
    us = np.linspace(-u0, u0, n)
    t = 1 - (us / u0) ** 2
    up = [(u, cy + top * t[i] ** 0.8) for i, u in enumerate(us)]
    lo = [(u, cy + bot * t[i] ** 0.6) for i, u in reversed(list(enumerate(us)))]
    return up + lo


def mouth_frame(char_rgb, kind):
    M = MOUTH; box = M['box']; L = Local(M['c'], M['ang'], box)
    spec = {'small': (11, -2.2, 4.0), 'mid': (14, -3.5, 8.5), 'open': (16, -4.5, 14.0)}[kind]
    u0, top, bot = spec
    # skin patch covers old line (u in +-26, v in -4..5) and the new mouth
    pm, pd = canvas(box)
    ell = [(30 * np.cos(t), 1.5 + (bot + 8 if np.sin(t) > 0 else 9) * np.sin(t)) for t in np.linspace(0, 2 * np.pi, 60)]
    pd.polygon(L(ell), fill=(255, 255, 255, 255))
    patch = down(pm, box)[..., 3] > 0.5
    old = np.zeros_like(patch)
    om, od = canvas(box)
    od.line(L([(-27, 0.5), (0, 0), (27, -0.5)]), fill=(255, 255, 255, 255), width=7 * SS)
    old = down(om, box)[..., 3] > 0.05
    skin = skin_patch(char_rgb, box, dilate(old, 1))
    im, d = canvas(box)
    outline = lens(u0, top, bot)
    d.polygon(L(outline), fill=(96, 38, 50, 255))
    # tongue / teeth clipped to mouth
    lay, ld = canvas(box)
    if kind in ('mid', 'open'):
        ld.ellipse([0, 0, 1, 1], fill=(0, 0, 0, 0))
        tg = [(u, bot * 0.25 + (bot * 0.75) * (1 - (u / (u0 * 0.8)) ** 2) ** 0.5 * 0.0 + bot * 0.2) for u in np.linspace(-u0 * 0.8, u0 * 0.8, 20)]
        tongue = tg + [(u0 * 0.8, bot + 2), (-u0 * 0.8, bot + 2)]
        ld.polygon(L(tongue), fill=(200, 98, 108, 255))
    if kind == 'open':
        teeth = [(u, top * (1 - (u / u0) ** 2) ** 0.8 - 1) for u in np.linspace(-u0 * 0.75, u0 * 0.75, 20)]
        teeth += [(u, top * (1 - (u / u0) ** 2) ** 0.8 + 2.6) for u in np.linspace(u0 * 0.7, -u0 * 0.7, 20)]
        ld.polygon(L(teeth), fill=(246, 238, 236, 255))
    mouth_a = np.array(im)[..., 3:4] / 255.0
    lay_np = np.array(lay).astype(np.float32); lay_np[..., 3:4] *= mouth_a
    base = np.array(im).astype(np.float32)
    la = lay_np[..., 3:4] / 255.0
    base[..., :3] = base[..., :3] * (1 - la) + lay_np[..., :3] * la
    im = Image.fromarray(base.astype(np.uint8), 'RGBA'); d = ImageDraw.Draw(im)
    # upper lip line (style of the original drawing) with tapered corners
    up = outline[:len(outline) // 2]
    ext = [(-u0 - 4, 0.6)] + up + [(u0 + 4, -0.4)]
    d.line(L(ext), fill=LINE_RGB + (255,), width=int(1.6 * SS), joint='curve')
    # lower lip soft shading
    d.line(L([(u * 0.6, bot + 2.5) for u in np.linspace(-u0 * 0.6, u0 * 0.6, 10)]), fill=(212, 150, 146, 120), width=int(1.6 * SS))
    rgb, a = compose(skin, patch | dilate(old, 2), down(im, box))
    return rgb, a


def skin_fill(crop, patch):
    """fill `patch` with a smooth field built only from skin-like pixels around it."""
    c = crop.astype(np.float32)
    lum = c.mean(-1)
    skinlike = (c[..., 0] > c[..., 2] + 18) & (lum > 140)
    src = skinlike & ~dilate(patch, 1) & dilate(patch, 14)
    out = c.copy(); filled = np.zeros(patch.shape, bool); acc = np.zeros_like(c)
    for s in (3, 6, 12, 24):
        num = cv2.GaussianBlur(c * src[..., None], (0, 0), s)
        den = cv2.GaussianBlur(src.astype(np.float32), (0, 0), s)
        ok = (den > 0.02) & ~filled
        acc[ok] = num[ok] / den[ok][:, None]; filled |= ok
    out[patch] = acc[patch]
    return out


def local_uv(E, box):
    yy, xx = np.mgrid[0:box[3], 0:box[2]].astype(np.float32)
    dx = xx + box[0] - E['c'][0]; dy = yy + box[1] - E['c'][1]
    r = np.deg2rad(E['ang'])
    return dx * np.cos(r) + dy * np.sin(r), -dx * np.sin(r) + dy * np.cos(r)


def hair_px(crop):
    c = crop.astype(np.float32); lum = c.mean(-1)
    return (c[..., 2] > c[..., 0] * 1.22 + 4) & (c[..., 2] > 50) & (lum < 205)


from eyes import eye_frame  # noqa: E402,F401
