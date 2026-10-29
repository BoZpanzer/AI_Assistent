import { useEffect, useRef, useState } from 'preact/hooks';

// Source frames: Jarvis_Tanz_Einzelbilder.zip (320x512 transparent PNGs).
const ROOT = 'assets/pet/frau/dance/';
const front = ['tanz_vorne_03_mitte','tanz_vorne_02_zwischen_a','tanz_vorne_01_seite_a','tanz_vorne_02_zwischen_a','tanz_vorne_03_mitte','tanz_vorne_04_zwischen_b','tanz_vorne_05_seite_b','tanz_vorne_04_zwischen_b'];
const back = front.map(s => s.replace('vorne','hinten'));
const jumpOut = ['01_ausholen','02_absprung','03_drehung_1','04_drehung_2','05_drehung_3','06_landung'].map(s => 'sprung_vorne_nach_hinten_' + s);
const jumpIn = ['01_ausholen','02_absprung','03_drehung_1','04_drehung_2','05_drehung_3','06_landung'].map(s => 'sprung_hinten_nach_vorne_' + s);
const frames = [...front, ...jumpOut, ...back, ...jumpIn];
const durations = [...front.map(() => 260), ...[160,130,140,140,160,220], ...back.map(() => 260), ...[160,130,140,140,160,220]];
const total = durations.reduce((a,b) => a+b, 0);
const urls = [...new Set(frames)].map(s => ROOT + s + '.png');

// Decode once per renderer. A failed load stays on the normal animated pet.
let loaded;
function preload() {
  return loaded ||= Promise.all(urls.map(src => new Promise(resolve => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  }))).then(images => images.every(im => im?.naturalWidth > 0));
}

export function AlyaDance({ size, fallback, onPointerDown, onContextMenu, onMouseEnter, onMouseLeave }) {
  const image = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    preload().then(ok => { if (alive) setReady(ok); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let timer;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let start = performance.now();
    const tick = () => {
      clearTimeout(timer);
      if (!image.current) return;
      const t = (performance.now() - start) % total;
      let elapsed = 0, idx = 0;
      while (idx < durations.length - 1 && elapsed + durations[idx] <= t) elapsed += durations[idx++];
      image.current.src = ROOT + frames[motion.matches ? 0 : idx] + '.png';
      if (!motion.matches) timer = setTimeout(tick, Math.max(16, elapsed + durations[idx] - t));
    };
    const restart = () => { start = performance.now(); tick(); };
    motion.addEventListener('change', restart);
    tick();
    return () => { clearTimeout(timer); motion.removeEventListener('change', restart); };
  }, [ready]);
  if (!ready) return fallback;
  return <div class="pet-fig pet-img s-dance has-pose" style={{ width: size + 'px', height: Math.round(size * 1.6) + 'px' }}
    onPointerDown={onPointerDown} onContextMenu={onContextMenu} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
    <div class="body"><img ref={image} src={ROOT + frames[0] + '.png'} width={size} height={Math.round(size * 1.6)} draggable={false} alt="Alya tanzt" onError={() => setReady(false)} /></div>
  </div>;
}
