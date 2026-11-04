"""Build the PNGTuber rig from public/assets/radio/host.png.
Run: python tools/rig/build.py   (outputs -> public/assets/radio/rig/, checks -> tools/rig/_check_*.png)
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import layers, background, faces

PIVOT = (590, 1010)


def main():
    os.makedirs(OUT, exist_ok=True)
    host = load_rgb(HOST)
    soft, mainm, fg = layers.build_masks(host)
    crgb, ca, body, ext = layers.char_layer(host, soft, mainm, fg)
    save_rgba(os.path.join(OUT, 'char.png'), crgb, ca)
    frgb, fa = layers.fg_layer(host, fg)
    save_rgba(os.path.join(OUT, 'fg.png'), frgb, fa)
    bg, hole, warped = background.build_bg(host, load_rgb(GEN), mainm, fg)
    Image.fromarray(bg).save(os.path.join(OUT, 'bg.png'), optimize=True)
    Image.fromarray(warped).save(os.path.join(TMP, '_bg_warped.png'))
    for k in ('small', 'mid', 'open'):
        rgb, a = faces.mouth_frame(crgb, k)
        save_rgba(os.path.join(OUT, f'mouth_{k}.png'), rgb, a)
        assert max(a[0].max(), a[-1].max(), a[:, 0].max(), a[:, -1].max()) < 0.02, 'mouth frame touches box edge'
    for k in ('half', 'closed'):
        rgb, a = faces.eye_frame(crgb, k)
        save_rgba(os.path.join(OUT, f'eyes_{k}.png'), rgb, a)
        assert max(a[0].max(), a[-1].max(), a[:, 0].max(), a[:, -1].max()) < 0.02, 'eye frame touches box edge'
    bx = lambda b: dict(x=b[0], y=b[1], w=b[2], h=b[3])
    rig = {
        'width': W, 'height': H,
        'layers': {'background': 'bg.png', 'character': 'char.png', 'foreground': 'fg.png'},
        'pivot': {'x': PIVOT[0], 'y': PIVOT[1]},
        'mouth': {'box': bx(faces.MOUTH['box']),
                  'frames': {'closed': None, 'small': 'mouth_small.png', 'mid': 'mouth_mid.png', 'open': 'mouth_open.png'}},
        'eyes': {'box': bx(faces.EYE_BOX),
                 'frames': {'open': None, 'half': 'eyes_half.png', 'closed': 'eyes_closed.png'}},
    }
    with open(os.path.join(OUT, 'rig.json'), 'w', encoding='utf-8') as f:
        json.dump(rig, f, indent=2)
    print('built', OUT)


if __name__ == '__main__':
    main()
