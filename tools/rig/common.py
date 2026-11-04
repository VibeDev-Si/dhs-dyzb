"""Shared paths and helpers for the PNGTuber rig build (tools/rig)."""
import os
import numpy as np
import cv2
from PIL import Image

TMP = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(TMP, '..', '..'))
HOST = os.path.join(ROOT, 'public', 'assets', 'radio', 'host.png')
OUT = os.path.join(ROOT, 'public', 'assets', 'radio', 'rig')
GEN = os.path.join(TMP, 'bg_gen.png')          # generated "empty room" plate (image_generate)
MASK_CACHE = os.path.join(TMP, '_mask_raw.png')  # rembg isnet-anime mask cache
W, H = 1086, 1448


def load_rgb(p):
    return np.array(Image.open(p).convert('RGB'))


def save_rgba(path, rgb, alpha):
    a = np.clip(alpha, 0, 1) if alpha.dtype != np.uint8 else alpha / 255.0
    out = np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), (a * 255 + 0.5).astype(np.uint8)])
    Image.fromarray(out, 'RGBA').save(path, optimize=True)


def raw_mask(host):
    """rembg isnet-anime soft mask (uint8), cached."""
    if not os.path.exists(MASK_CACHE):
        from rembg import new_session, remove
        m = remove(Image.fromarray(host), session=new_session('isnet-anime'), only_mask=True)
        m.save(MASK_CACHE)
    return np.array(Image.open(MASK_CACHE).convert('L'))


def disk(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def dilate(m, r):
    return cv2.dilate(m.astype(np.uint8), disk(r)) > 0


def erode(m, r):
    return cv2.erode(m.astype(np.uint8), disk(r)) > 0


def feather(m, sigma):
    return cv2.GaussianBlur(m.astype(np.float32), (0, 0), sigma)


def poly_mask(polys, shape=(H, W)):
    m = np.zeros(shape, np.uint8)
    for p in polys:
        cv2.fillPoly(m, [np.array(p, np.int32)], 1)
    return m > 0
