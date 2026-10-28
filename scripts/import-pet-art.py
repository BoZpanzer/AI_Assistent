#!/usr/bin/env python3
"""Figur-Bilder (PNG, transparent, je Figur gleiche Größe) → kleine WebP-Dateien für die App.
Aufruf: python3 scripts/import-pet-art.py <ordner-mit-frau-und-mann> 
- Front-Bilder werden an den Füßen von idle.png ausgerichtet (weniger Springen beim Umschalten).
- Ausgabe: src/renderer/assets/pet/<frau|mann>/<pose>.webp (400 × 600) + src/renderer/src/pet-art.js (Liste).
"""
import json, os, sys
from PIL import Image
import numpy as np

POSES = ['idle', 'blink', 'talk', 'think', 'listen', 'wave', 'happy', 'oops', 'sleep', 'walk1', 'walk2']
OUT_W, OUT_H = 400, 600
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def anchor(im):
    a = np.asarray(im.getchannel('A')) > 40
    rows = np.nonzero(a.any(axis=1))[0]
    if not len(rows): return None
    yb = rows[-1]
    band = a[max(0, yb - int(im.height * 0.08)):yb + 1]
    xs = np.nonzero(band)[1]
    return (float(xs.mean()) if len(xs) else im.width / 2, float(yb))

def main(src):
    art = {}
    for folder, key in (('frau', 'female'), ('mann', 'male')):
        d = os.path.join(src, folder)
        if not os.path.isdir(d): continue
        base = Image.open(os.path.join(d, 'idle.png')).convert('RGBA') if os.path.exists(os.path.join(d, 'idle.png')) else None
        if base is None: print('übersprungen (idle.png fehlt):', folder); continue
        ax, ay = anchor(base)
        def cx(im):
            a = np.asarray(im.getchannel('A')) > 40
            xs = np.nonzero(a)[1]
            return float(xs.mean()) if len(xs) else im.width / 2
        w1 = os.path.join(d, 'walk1.png')
        walk_cx = cx(Image.open(w1).convert('RGBA')) if os.path.exists(w1) else None
        out = os.path.join(root, 'src', 'renderer', 'assets', 'pet', folder)
        os.makedirs(out, exist_ok=True)
        art[key] = {}
        for pose in POSES:
            p = os.path.join(d, pose + '.png')
            if not os.path.exists(p): continue
            try:
                im = Image.open(p).convert('RGBA'); im.load()
            except Exception as e:
                print('kaputt:', p, e); continue
            if im.size != base.size: im = im.resize(base.size, Image.LANCZOS)
            a = anchor(im)
            if a:
                # Laufbilder untereinander an der Körpermitte ausrichten, Standbilder an den Füßen von idle
                dx = (round(walk_cx - cx(im)) if walk_cx is not None else 0) if pose.startswith('walk') else round(ax - a[0])
                dy = round(ay - a[1])
                if abs(dx) > im.width * 0.08: dx = 0  # Pose weicht stark ab → nur die Höhe angleichen
                c = Image.new('RGBA', im.size); c.alpha_composite(im, (dx, dy)); im = c
            im = im.resize((OUT_W, round(OUT_W * base.height / base.width)), Image.LANCZOS)
            im.save(os.path.join(out, pose + '.webp'), 'WEBP', quality=86, method=6)
            art[key][pose] = f'assets/pet/{folder}/{pose}.webp'
        print(folder, sorted(art[key]))
    js = '// Automatisch erzeugt von scripts/import-pet-art.py – Bilder der Figuren (fehlt eine Figur, zeichnet JARVIS die Ersatzfigur).\n'
    js += 'export const PET_ART = ' + json.dumps(art, indent=2) + ';\n'
    js += f'export const PET_ART_RATIO = {OUT_H / OUT_W};\n'
    open(os.path.join(root, 'src', 'renderer', 'src', 'pet-art.js'), 'w', encoding='utf-8').write(js)

if __name__ == '__main__':
    main(sys.argv[1])
