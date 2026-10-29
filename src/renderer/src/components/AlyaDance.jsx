import { useEffect, useRef, useState } from 'preact/hooks';

// Source frames: Jarvis_Tanz_Einzelbilder.zip (320x512 transparent PNGs).
const ROOT = 'assets/pet/frau/dance/';
const front = ['tanz_vorne_03_mitte','tanz_vorne_02_zwischen_a','tanz_vorne_01_seite_a','tanz_vorne_02_zwischen_a','tanz_vorne_03_mitte','tanz_vorne_04_zwischen_b','tanz_vorne_05_seite_b','tanz_vorne_04_zwischen_b'];
const back = front.map(s => s.replace('vorne','hinten'));
const jumpOut = ['01_ausholen','02_absprung','03_drehung_1','04_drehung_2','05_drehung_3','06_landung'].map(s => 'sprung_vorne_nach_hinten_' + s);
const jumpIn = ['01_ausholen','02_absprung','03_drehung_1','04_drehung_2','05_drehung_3','06_landung'].map(s => 'sprung_hinten_nach_vorne_' + s);
const frames = [...front, ...jumpOut, ...back, ...jumpIn];
const durations = [...[145,115,155,115,145,115,155,115], ...[105,85,80,80,90,115], ...[145,115,155,115,145,115,155,115], ...[105,85,80,80,90,115]];
const total = durations.reduce((a,b) => a+b, 0);
const urls = [...new Set(frames)].map(s => ROOT + s + '.png');

// Decode once per renderer and keep GPU textures pinned via pre-mounted <img> layers (zero src-swap/canvas flicker).
const playFrames = [...front, ...front, ...jumpOut, ...back, ...back, ...jumpIn];
const playDurations = [
  ...[145,115,155,115,145,115,155,115], ...[145,115,155,115,145,115,155,115],
  ...[105,85,80,80,90,115],
  ...[145,115,155,115,145,115,155,115], ...[145,115,155,115,145,115,155,115],
  ...[105,85,80,80,90,115],
];
const playTotal = playDurations.reduce((a, b) => a + b, 0);

let loaded;
let kept = [];
function preload() {
  return loaded ||= Promise.all(urls.map(src => new Promise(resolve => {
    const im = new Image();
    im.decoding = 'sync';
    im.onload = () => {
      if (typeof im.decode === 'function') im.decode().catch(() => {}).finally(() => resolve(im));
      else resolve(im);
    };
    im.onerror = () => resolve(null);
    im.src = src;
  }))).then(images => {
    const ok = images.every(im => im?.naturalWidth > 0);
    if (ok) kept = images; else loaded = null;
    return ok;
  });
}

export function AlyaDance({ size, fallback, onPointerDown, onContextMenu, onMouseEnter, onMouseLeave }) {
  const boxRef = useRef(null);
  const [ready, setReady] = useState(() => kept.length === urls.length);
  useEffect(() => {
    if (ready) return undefined;
    let alive = true;
    preload().then(ok => { if (alive) setReady(ok); });
    return () => { alive = false; };
  }, [ready]);
  useEffect(() => {
    if (!ready) return undefined;
    let timer;
    let lastUrl = '';
    const start = performance.now();
    const tick = () => {
      clearTimeout(timer);
      const root = boxRef.current;
      if (!root) return;
      const t = (performance.now() - start) % playTotal;
      let elapsed = 0, idx = 0;
      while (idx < playDurations.length - 1 && elapsed + playDurations[idx] <= t) elapsed += playDurations[idx++];
      const next = ROOT + playFrames[idx] + '.png';
      if (next !== lastUrl) {
        lastUrl = next;
        const imgs = root.children;
        for (let i = 0; i < imgs.length; i++) {
          const on = imgs[i].dataset.src === next;
          imgs[i].style.opacity = on ? '1' : '0';
        }
      }
      timer = setTimeout(tick, Math.max(16, elapsed + playDurations[idx] - t));
    };
    tick();
    return () => clearTimeout(timer);
  }, [ready]);
  if (!ready) return fallback;
  const h = Math.round(size * 1.6);
  const firstUrl = ROOT + playFrames[0] + '.png';
  return <div class="pet-fig pet-img s-dance has-pose" style={{ width: size + 'px', height: h + 'px' }}
    onPointerDown={onPointerDown} onContextMenu={onContextMenu} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
    <div ref={boxRef} class="body" style={{ position: 'relative', width: size + 'px', height: h + 'px' }}>
      {urls.map((u) => (
        <img key={u} data-src={u} src={u} width={size} height={h} decoding="sync" draggable={false} alt="Alya tanzt"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: u === firstUrl ? 1 : 0, pointerEvents: 'none' }}
          onError={() => setReady(false)} />
      ))}
    </div>
  </div>;
}
