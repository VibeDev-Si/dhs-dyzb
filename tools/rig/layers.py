"""Character / foreground masks and the character layer with hidden extensions."""
import numpy as np
import cv2
from common import *

DESK_Y = 963  # top of the desk surface in front of her (everything below = foreground)
# microphone (head, collar, cage, stem) – drawn in front of her
MIC = [
    [(196, 560), (232, 548), (272, 556), (290, 590), (292, 640), (284, 680), (250, 690), (206, 684), (190, 640), (188, 596)],
    [(176, 684), (300, 676), (306, 712), (172, 718)],
    [(160, 712), (318, 706), (322, 760), (296, 812), (246, 830), (196, 818), (164, 772)],
    [(226, 820), (268, 820), (272, 966), (222, 966)],
]
# zones where anything NOT in the rembg character mask is a static object in front of her
OBJ_ZONES = [
    [(0, 880), (130, 880), (130, 970), (0, 970)],                 # box at lower-left
    [(1008, 760), (1086, 760), (1086, 970), (1008, 970)],          # flower jar at right
]
# zones inside the rembg mask that are objects, not her (ink jar + letter bundle on desk)
SOLID_ZONES = [
    [(898, 912), (1004, 912), (1004, 970), (898, 970)],
]


def build_masks(host):
    raw = raw_mask(host).astype(np.float32) / 255.0
    hard = raw > 0.5
    # keep the main component, fill small holes (gaps between strands kept if big)
    n, lab, st, _ = cv2.connectedComponentsWithStats(hard.astype(np.uint8))
    main = lab == (1 + np.argmax(st[1:, cv2.CC_STAT_AREA]))
    inv = (~main).astype(np.uint8)
    n2, lab2, st2, _ = cv2.connectedComponentsWithStats(inv)
    for i in range(1, n2):
        if st2[i, cv2.CC_STAT_AREA] < 400:
            main[lab2 == i] = True
    soft = np.where(main, raw, raw * dilate(main, 40))  # keep faint hair wisps (bg hole covers them)
    soft[main & erode(main, 2)] = 1.0
    yy = np.arange(H)[:, None] * np.ones((1, W))
    fg = (yy >= DESK_Y) | poly_mask(MIC) | poly_mask(SOLID_ZONES)
    fg |= poly_mask(OBJ_ZONES) & ~dilate(main, 2)
    return soft, main, fg


def char_layer(host, soft, main, fg):
    """RGBA character: visible body + body-coloured extension hidden under fg."""
    body = main & ~fg
    ext = dilate(body, 40) & fg & (np.arange(H)[:, None] < DESK_Y + 40)
    # nearest visible body pixel colour for the hidden part
    _, lab = cv2.distanceTransformWithLabels((~erode(body, 2)).astype(np.uint8), cv2.DIST_L2, 5,
                                             labelType=cv2.DIST_LABEL_PIXEL)
    src = np.argwhere(erode(body, 2))  # labels follow zero-pixel scan order
    idx = lab - 1
    rgb = host.copy()
    fillc = host[src[idx[ext], 0], src[idx[ext], 1]]
    rgb[ext] = fillc
    rgb = np.where(ext[..., None], cv2.GaussianBlur(rgb, (0, 0), 2), rgb)
    alpha = np.where(fg, 0.0, soft)
    alpha = np.maximum(alpha, ext.astype(np.float32))
    return rgb, alpha, body, ext


def fg_layer(host, fg):
    a = feather(fg, 0.8)
    a[fg] = np.maximum(a[fg], 0.85)
    return host, a
