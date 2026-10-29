import { useEffect, useRef, useState } from 'preact/hooks';

// Source frames: Jarvis_Tanz_Einzelbilder.zip (320x512 transparent PNGs).
const ROOT = 'assets/pet/frau/dance/';
const front = ['tanz_vorne_03_mitte','tanz_vorne_02_zwischen_a','tanz_vorne_01_seite_a','tanz_vorne_02_zwischen_a','tanz_vorne_03_mitte','tanz_vorne_04_zwischen_b','tanz_vorne_05_seite_b','tanz_vorne_04_zwischen_b'];
const back = front.map(s => s.replace('vorne','hinten'));
const jumpOut = ['01_ausholen','02_absprung','03_drehung_1','04_drehung_2','05_drehung_3','06_landung'].map(s => 'sprung_vorne_nach_hinten_' + s);
const jumpIn = ['01_ausholen','02_absprung','03_drehung_1','04_drehung_2','05_drehung_3','06_landung'].map(s => 'sprung_hinten_nach_vorne_' + s);
const frames = [...front, ...jumpOut, ...back, ...jumpIn];
const durations = [...[150,125,160,125,150,125,160,125], ...[115,92,90,90,100,130], ...[150,125,160,125,150,125,160,125], ...[115,92,90,90,100,130]];
const total = durations.reduce((a,b) => a+b, 0);
const urls = [...new Set(frames)].map(s => ROOT + s + '.png');

// Decode once per renderer and precompute per-strip spine profiles for 60 FPS sub-frame warping.
const STRIPS = 48;
const SRC_W = 320;
const SRC_H = 512;
const playSeq = [...front, ...front, ...jumpOut, ...back, ...back, ...jumpIn];
const playDur = [
  ...[150,125,160,125,150,125,160,125], ...[150,125,160,125,150,125,160,125],
  ...[115,92,90,90,100,130],
  ...[150,125,160,125,150,125,160,125], ...[150,125,160,125,150,125,160,125],
  ...[115,92,90,90,100,130],
];
const playTotal = playDur.reduce((a, b) => a + b, 0);

let loaded;
const frameMap = new Map();

function analyzeFrame(im) {
  const c = document.createElement('canvas');
  c.width = SRC_W; c.height = SRC_H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(im, 0, 0, SRC_W, SRC_H);
  const data = ctx.getImageData(0, 0, SRC_W, SRC_H).data;
  const rawCx = new Float32Array(STRIPS);
  const sh = SRC_H / STRIPS;
  for (let s = 0; s < STRIPS; s++) {
    const y0 = Math.floor(s * sh), y1 = Math.min(SRC_H, Math.ceil((s + 1) * sh));
    let minX = SRC_W, maxX = -1;
    for (let y = y0; y < y1; y++) {
      const row = y * SRC_W * 4;
      for (let x = 0; x < SRC_W; x++) {
        if (data[row + x * 4 + 3] > 80) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    rawCx[s] = maxX >= minX ? 0.5 * (minX + maxX) : (s > 0 ? rawCx[s - 1] : SRC_W * 0.5);
  }
  const cx = new Float32Array(STRIPS);
  for (let s = 0; s < STRIPS; s++) {
    let sum = 0, wsum = 0;
    for (let k = -3; k <= 3; k++) {
      const idx = Math.max(0, Math.min(STRIPS - 1, s + k));
      const w = 4 - Math.abs(k);
      sum += rawCx[idx] * w; wsum += w;
    }
    cx[s] = sum / wsum;
  }
  return { im, cx };
}

function preload() {
  return loaded ||= Promise.all(urls.map(src => new Promise(resolve => {
    const im = new Image();
    im.onload = () => resolve({ src, im });
    im.onerror = () => resolve(null);
    im.src = src;
  }))).then(items => {
    const ok = items.every(it => it?.im?.naturalWidth > 0);
    if (ok) {
      for (const { src, im } of items) {
        const key = src.slice(ROOT.length, -4);
        frameMap.set(key, analyzeFrame(im));
      }
    } else {
      loaded = null;
    }
    return ok;
  });
}

function drawWarped(ctx, entry, targetEntry, shiftFactor, w, h, alpha = 1, dyPx = 0) {
  if (!entry || alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const shSrc = SRC_H / STRIPS;
  const shDst = h / STRIPS;
  const scaleX = w / SRC_W;
  for (let s = 0; s < STRIPS; s++) {
    const sy = s * shSrc;
    const dy = s * shDst + dyPx;
    const rawDelta = targetEntry ? (targetEntry.cx[s] - entry.cx[s]) * shiftFactor : 0;
    const dx = Math.max(-14, Math.min(14, rawDelta)) * scaleX;
    ctx.drawImage(entry.im, 0, sy, SRC_W, shSrc + 0.6, dx, dy, w, shDst + 0.45);
  }
  ctx.restore();
}

export function AlyaDance({ size, fallback, onPointerDown, onContextMenu, onMouseEnter, onMouseLeave }) {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(() => frameMap.size === urls.length);
  useEffect(() => {
    if (ready) return undefined;
    let alive = true;
    preload().then(ok => { if (alive) setReady(ok); });
    return () => { alive = false; };
  }, [ready]);
  useEffect(() => {
    if (!ready) return undefined;
    let raf;
    const start = performance.now();
    const render = (now) => {
      const cv = canvasRef.current;
      if (!cv) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = size;
      const h = Math.round(size * 1.6);
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const t = (now - start) % playTotal;
      let elapsed = 0, idx = 0;
      while (idx < playDur.length - 1 && elapsed + playDur[idx] <= t) elapsed += playDur[idx++];
      const dur = playDur[idx];
      const p = Math.max(0, Math.min(1, (t - elapsed) / dur));
      // Smoothstep easing within each keyframe interval
      const ease = p * p * (3 - 2 * p);

      const curName = playSeq[idx];
      const nextName = playSeq[(idx + 1) % playSeq.length];
      const cur = frameMap.get(curName);
      const next = frameMap.get(nextName);
      const isJump = curName.startsWith('sprung_') || nextName.startsWith('sprung_');

      // Subtle rhythmic knee-bounce on the hip-sway beat
      const bounceY = isJump ? 0 : Math.sin(ease * Math.PI) * (size * 0.008);

      if (!isJump && cur && next) {
        // Spine-warped 60 FPS interpolation with aligned-silhouette midpoint crossfade
        if (ease < 0.38) {
          drawWarped(ctx, cur, next, ease * 0.85, w, h, 1, bounceY);
        } else if (ease > 0.62) {
          drawWarped(ctx, next, cur, (1 - ease) * 0.85, w, h, 1, bounceY);
        } else {
          const blend = (ease - 0.38) / 0.24;
          drawWarped(ctx, cur, next, 0.45, w, h, 1 - blend, bounceY);
          drawWarped(ctx, next, cur, 0.45, w, h, blend, bounceY);
        }
      } else if (cur && next) {
        // Spin jump: crisp fast frames with brief aligned cross-dissolve at frame boundary
        if (ease < 0.72) {
          drawWarped(ctx, cur, next, ease * 0.35, w, h, 1, 0);
        } else {
          const blend = (ease - 0.72) / 0.28;
          drawWarped(ctx, cur, next, 0.35, w, h, 1 - blend, 0);
          drawWarped(ctx, next, cur, 0.25, w, h, blend, 0);
        }
      } else if (cur) {
        drawWarped(ctx, cur, null, 0, w, h, 1, 0);
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [ready, size]);
  if (!ready) return fallback;
  return <div class="pet-fig pet-img s-dance has-pose" style={{ width: size + 'px', height: Math.round(size * 1.6) + 'px' }}
    onPointerDown={onPointerDown} onContextMenu={onContextMenu} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
    <div class="body"><canvas ref={canvasRef} style={{ width: size + 'px', height: Math.round(size * 1.6) + 'px', display: 'block', pointerEvents: 'none' }} /></div>
  </div>;
}
