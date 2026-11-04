"""Background plate: host outside the character, aligned+colour-corrected generated plate inside."""
import numpy as np
import cv2
from common import *


def align_gen(host, gen, avoid):
    g = cv2.resize(gen, (W, H), interpolation=cv2.INTER_AREA)
    sift = cv2.SIFT_create(6000)
    keep = (~avoid).astype(np.uint8) * 255
    k1, d1 = sift.detectAndCompute(cv2.cvtColor(g, cv2.COLOR_RGB2GRAY), keep)
    k2, d2 = sift.detectAndCompute(cv2.cvtColor(host, cv2.COLOR_RGB2GRAY), keep)
    ms = cv2.BFMatcher().knnMatch(d1, d2, k=2)
    good = [m for m, n in ms if m.distance < 0.72 * n.distance]
    p1 = np.float32([k1[m.queryIdx].pt for m in good])
    p2 = np.float32([k2[m.trainIdx].pt for m in good])
    Hm, inl = cv2.findHomography(p1, p2, cv2.RANSAC, 4.0)
    print('bg align: matches', len(good), 'inliers', int(inl.sum()))
    return cv2.warpPerspective(g, Hm, (W, H), borderMode=cv2.BORDER_REPLICATE)


def build_bg(host, gen, main, fg):
    # everything she covers (plus margin) above the desk line; desk area stays original
    wisps = (raw_mask(host) > 8) & dilate(main, 40)   # faint semi-transparent hair edges
    hole = dilate(main | wisps, 14) & (np.arange(H)[:, None] < 963 + 6)
    warped = align_gen(host, gen, dilate(main, 20)).astype(np.float32)
    hf = host.astype(np.float32)
    ring = dilate(hole, 24) & ~hole
    diff = (hf - warped) * ring[..., None]
    corr = np.zeros_like(hf)
    wsum = np.zeros((H, W), np.float32)
    for s in (12, 40, 120):  # multi-scale normalized blur to push the correction inwards
        num = cv2.GaussianBlur(diff, (0, 0), s)
        den = cv2.GaussianBlur(ring.astype(np.float32), (0, 0), s)
        ok = den > 1e-3
        wgt = np.clip(den / 0.05, 0, 1) * (wsum < 0.999)
        c = np.where(ok[..., None], num / np.maximum(den, 1e-3)[..., None], 0)
        corr += c * (wgt * (1 - wsum))[..., None]
        wsum += wgt * (1 - wsum)
    patch = np.clip(warped + corr, 0, 255)
    a = feather(hole, 5)
    a[erode(hole, 6)] = 1.0
    bg = hf * (1 - a[..., None]) + patch * a[..., None]
    return bg.astype(np.uint8), hole, warped.astype(np.uint8)
