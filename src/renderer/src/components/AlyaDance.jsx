import { useEffect, useRef } from 'preact/hooks';

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

export function AlyaDance({ size, onPointerDown, onContextMenu, onMouseEnter, onMouseLeave }) {
  const image = useRef(null);
  const raf = useRef(0);
  useEffect(() => {
    const cache = new Map();
    let alive = true;
    const load = urls.map(src => {
      const im = new Image(); im.src = src; cache.set(src, im); return im;
    });
    let start = performance.now();
    let last = -1;
    const tick = now => {
      if (!alive) return;
      const t = (now - start) % total;
      let elapsed = 0, idx = 0;
      while (idx < durations.length - 1 && elapsed + durations[idx] <= t) elapsed += durations[idx++];
      if (idx !== last) {
        last = idx;
        const src = ROOT + frames[idx] + '.png';
        const im = cache.get(src);
        if (image.current && im?.complete && im.naturalWidth) image.current.src = src;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf.current); load.forEach(im => { im.onload = null; }); };
  }, []);
  return <div class="pet-fig pet-img s-dance has-pose" style={{ width: size + 'px', height: Math.round(size * 1.6) + 'px' }}
    onPointerDown={onPointerDown} onContextMenu={onContextMenu} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
    <div class="body"><img ref={image} src={ROOT + front[0] + '.png'} width={size} height={Math.round(size * 1.6)} draggable={false} alt="Alya tanzt" /></div>
  </div>;
}
