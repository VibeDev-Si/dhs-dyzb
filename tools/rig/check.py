"""Composite previews from the built rig to verify it (reads rig.json like the page would)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from PIL import ImageDraw

rig = json.load(open(os.path.join(OUT, 'rig.json'), encoding='utf-8'))
L = lambda n: Image.open(os.path.join(OUT, n)).convert('RGBA')
host = Image.open(HOST).convert('RGBA')
bg, ch, fg = L('bg.png'), L('char.png'), L('fg.png')


def stack(char_img, overlays=()):
    c = char_img.copy()
    for name, box in overlays:
        c.alpha_composite(L(name), (box['x'], box['y']))
    out = bg.copy(); out.alpha_composite(c); out.alpha_composite(fg)
    return out


def transform(img, dy, deg):
    px, py = rig['pivot']['x'], rig['pivot']['y']
    return img.rotate(deg, resample=Image.BICUBIC, center=(px, py), translate=(0, dy))


base = stack(ch)
base.convert('RGB').save(os.path.join(OUT, '_preview_base.png'))
diff = np.abs(np.array(base.convert('RGB')).astype(int) - np.array(host.convert('RGB')).astype(int)).sum(-1)
print('base diff mean', diff.mean(), 'p99', np.percentile(diff, 99), 'px>30:', int((diff > 30).sum()))
dimg = Image.fromarray(np.clip(diff * 4, 0, 255).astype(np.uint8)).convert('RGB')
sbs = Image.new('RGB', (W * 3 // 2, H // 2))
for i, im in enumerate([host.convert('RGB'), base.convert('RGB'), dimg]):
    sbs.paste(im.resize((W // 2, H // 2)), (i * W // 2, 0))
sbs.save(os.path.join(TMP, '_check_base.png'))

# frames contact sheet, face crop zoomed 3x
crop = (430, 270, 650, 450); z = 3
tiles = [('base', [])]
mb, eb = rig['mouth']['box'], rig['eyes']['box']
tiles += [(k, [(v, mb)]) for k, v in rig['mouth']['frames'].items() if v]
tiles += [(k, [(v, eb)]) for k, v in rig['eyes']['frames'].items() if v]
tw, th = (crop[2] - crop[0]) * z, (crop[3] - crop[1]) * z
sheet = Image.new('RGB', (tw * 3, th * 2 + 40), (30, 30, 30))
d = ImageDraw.Draw(sheet)
for i, (name, ov) in enumerate(tiles):
    t = stack(ch, ov).crop(crop).resize((tw, th), Image.LANCZOS)
    sheet.paste(t.convert('RGB'), ((i % 3) * tw, (i // 3) * (th + 20) + 20))
    d.text(((i % 3) * tw + 6, (i // 3) * (th + 20) + 4), name, fill=(255, 255, 0))
sheet.save(os.path.join(TMP, '_check_frames.png'))

# motion: char + overlays transformed together
c = ch.copy(); c.alpha_composite(L('mouth_open.png'), (mb['x'], mb['y'])); c.alpha_composite(L('eyes_closed.png'), (eb['x'], eb['y']))
outs = []
for dy, deg in ((12, 1.2), (-8, -1.2)):
    o = bg.copy(); o.alpha_composite(transform(c, dy, deg)); o.alpha_composite(fg); outs.append(o.convert('RGB'))
m = Image.new('RGB', (W * 2, H)); m.paste(outs[0], (0, 0)); m.paste(outs[1], (W, 0))
m.resize((W, H // 2)).save(os.path.join(TMP, '_check_motion.png'))
outs[0].save(os.path.join(TMP, '_check_motion_full.png'))
bg.convert('RGB').resize((W // 2, H // 2)).save(os.path.join(TMP, '_check_bg.png'))
print('checks written')
