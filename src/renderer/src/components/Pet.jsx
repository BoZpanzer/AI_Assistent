import { useEffect, useState } from 'preact/hooks';
import { PET_ART, PET_ART_RATIO } from '../pet-art.js';
/**
 * JARVIS als Anime-Figur (eigene Gestaltung, reines SVG): feste Outline, Cel-Shading, Kopf zu Körper ca. 1 : 5,
 * Shirt mit JARVIS-Schriftzug. gender: 'male' (J.A.R.V.I.S./Standard) | 'female' (Alya).
 * state: idle | walk | talk | think | listen | wave | happy | sleep | oops – Animationen in styles/pet.css.
 * Arme gibt es in mehreren Haltungen (Hüfte, Winken, Kinn, Geste, Kopfkratzen); CSS blendet je Zustand die passende ein.
 */
const OL = '#1b1424';
const SKIN = '#ffe3d3'; const SKIN_SH = '#f2bfa8';

/** Arm als dicker Strich mit Outline (Oberarm in Ärmelfarbe, Unterarm Haut) + Hand. */
function Arm({ d, sleeve, sleeveTo = 0.5, hand, cls }) {
  const pts = d.split(/\s*L\s*|\s*M\s*/).filter(Boolean).map((p) => p.trim().split(/[\s,]+/).map(Number));
  const [a, b, c] = pts;
  const mid = [a[0] + (b[0] - a[0]) * (sleeveTo * 2 > 1 ? 1 : sleeveTo * 2), a[1] + (b[1] - a[1]) * (sleeveTo * 2 > 1 ? 1 : sleeveTo * 2)];
  const line = (q, col, w) => <path d={q} fill="none" stroke={col} stroke-width={w} stroke-linecap="round" stroke-linejoin="round" />;
  return (
    <g class={cls}>
      {line(d, OL, 8.4)}
      {line(d, SKIN, 5.6)}
      {sleeve && line(`M${a[0]} ${a[1]} L${mid[0]} ${mid[1]}`, sleeve, 6.4)}
      <circle cx={c[0]} cy={c[1]} r={hand || 3.9} fill={SKIN} stroke={OL} stroke-width="1.4" />
    </g>
  );
}

const ARMS_R = { hip: 'M84 92 L92 116 L79 134', up: 'M84 92 L96 72 L101 50', chin: 'M84 92 L89 114 L68 76', out: 'M84 92 L94 115 L106 104', scratch: 'M84 92 L99 76 L86 44' };
const ARMS_L = { hip: 'M36 92 L28 116 L41 134', up: 'M36 92 L24 72 L19 50' };

function Arms({ sleeve, sleeveTo }) {
  return (
    <>
      <g class="arm arm-l">{Object.entries(ARMS_L).map(([k, d]) => <Arm cls={'pose p-' + k} d={d} sleeve={sleeve} sleeveTo={sleeveTo} />)}</g>
      <g class="arm arm-r">{Object.entries(ARMS_R).map(([k, d]) => <Arm cls={'pose p-' + k} d={d} sleeve={sleeve} sleeveTo={sleeveTo} />)}</g>
    </>
  );
}

function Eyes({ iris, cx = [52, 68], cy = 50, rx = 4.6, ry = 5.6, closed }) {
  if (closed) {
    return <g class="eyes-closed" fill="none" stroke={OL} stroke-width="1.8" stroke-linecap="round">{cx.map((x) => <path d={`M${x - 5} ${cy} Q${x} ${cy + 3.6} ${x + 5} ${cy}`} />)}</g>;
  }
  return (
    <g class="eyes">
      {cx.map((x, i) => (
        <g>
          <ellipse cx={x} cy={cy} rx={rx} ry={ry} fill="#fff" />
          <ellipse cx={x} cy={cy + 0.8} rx={rx * 0.78} ry={ry * 0.86} fill={iris} />
          <ellipse cx={x} cy={cy + 2.6} rx={rx * 0.7} ry={ry * 0.38} fill="#fff" opacity="0.28" />
          <ellipse cx={x} cy={cy + 0.4} rx={rx * 0.34} ry={ry * 0.5} fill="#120d18" />
          <circle cx={x + (i ? -1.2 : 1.2)} cy={cy - 2} r="1.25" fill="#fff" />
          <path d={`M${x - rx - 1.2} ${cy - 2.2} Q${x} ${cy - ry - 2.6} ${x + rx + 1.4} ${cy - 3}${i ? '' : ` L${x + rx + 2.6} ${cy - 4.4}`}`} fill="none" stroke={OL} stroke-width="1.9" stroke-linecap="round" />
        </g>
      ))}
    </g>
  );
}

function Mouth({ state, y = 62 }) {
  return (
    <>
      <g class="mouth-closed" fill="none" stroke={OL} stroke-width="1.2" stroke-linecap="round">
        {state === 'oops' ? <path d={`M57 ${y + 1} Q60 ${y - 1} 63 ${y + 1}`} /> : state === 'think' ? <path d={`M58 ${y} L62 ${y - 0.6}`} /> : <path d={`M56.5 ${y - 0.6} Q60 ${y + 2.4} 63.5 ${y - 0.6}`} />}
      </g>
      <g class="mouth-open"><path d={`M56.8 ${y - 1} Q60 ${y - 1.6} 63.2 ${y - 1} Q62.6 ${y + 3.6} 60 ${y + 3.8} Q57.4 ${y + 3.6} 56.8 ${y - 1}Z`} fill="#7c2c3b" stroke={OL} stroke-width="1" /><path d={`M58 ${y + 2.4} Q60 ${y + 1.2} 62 ${y + 2.4} Q60 ${y + 3.4} 58 ${y + 2.4}Z`} fill="#ff8a96" /></g>
    </>
  );
}

function Female({ state }) {
  const hair = '#3b2230'; const hairMid = '#5a3346'; const hairHi = '#8a5a76'; const iris = '#8d63ff';
  const closed = state === 'sleep' || state === 'happy';
  return (
    <g stroke={OL} stroke-width="1.5" stroke-linejoin="round">
      {/* Haare hinten: lang, wild, mit Spitzen */}
      <path d="M36 26 Q18 52 21 92 Q16 126 23 160 L29 150 L31 172 L38 152 L41 166 L45 146 Q60 140 75 146 L79 166 L82 152 L89 172 L91 150 L97 160 Q104 126 99 92 Q102 52 84 26 Q60 8 36 26Z" fill={hair} />
      <path d="M30 60 Q26 100 30 140 M90 60 Q94 100 90 140" fill="none" stroke={hairMid} stroke-width="2" />
      <g class="legs">
        <g class="leg leg-l">
          <path d="M42 148 Q38 178 44 204 Q42 222 46 238 L54 238 Q57 222 56 204 Q61 178 60.5 150Z" fill={SKIN} />
          <path d="M41.6 182 Q41.4 196 44 204 Q42 222 46 238 L54 238 Q57 222 56 204 Q59.4 194 59.8 182 Q50 186 41.6 182Z" fill="#1d1b26" />
          <path d="M41.6 182 Q50 186 59.8 182" fill="none" stroke="#3a3650" stroke-width="2.4" />
          <path d="M39 238 Q36 248 43 250 L58 250 Q61 244 55 237Z" fill="#f6f7fb" /><path d="M38.6 246 L59 246" stroke-width="1" /><path d="M44 240 L52 240" stroke="#22d3ee" stroke-width="1.6" />
        </g>
        <g class="leg leg-r">
          <path d="M78 148 Q82 178 76 204 Q78 222 74 238 L66 238 Q63 222 64 204 Q59 178 59.5 150Z" fill={SKIN} />
          <path d="M78.4 182 Q78.6 196 76 204 Q78 222 74 238 L66 238 Q63 222 64 204 Q60.6 194 60.2 182 Q70 186 78.4 182Z" fill="#1d1b26" />
          <path d="M78.4 182 Q70 186 60.2 182" fill="none" stroke="#3a3650" stroke-width="2.4" />
          <path d="M81 238 Q84 248 77 250 L62 250 Q59 244 65 237Z" fill="#f6f7fb" /><path d="M81.4 246 L61 246" stroke-width="1" /><path d="M76 240 L68 240" stroke="#22d3ee" stroke-width="1.6" />
        </g>
      </g>
      <g class="upper">
        {/* Rock */}
        <path d="M44 128 L76 128 L89 158 Q60 167 31 158Z" fill="#2a3352" />
        <path d="M50 131 L45 161 M60 131 L60 164 M70 131 L75 161" fill="none" stroke="#1a2038" stroke-width="1.2" />
        <path d="M44 128 L76 128 L77 133 L43 133Z" fill="#1a2038" />
        {/* Shirt */}
        <rect x="55.5" y="64" width="9" height="14" fill={SKIN_SH} />
        <path d="M40 79 Q60 72 80 79 L85 92 Q87 110 79 126 L77 131 L43 131 L41 126 Q33 110 35 92Z" fill="#fbfbff" />
        <path d="M43 105 Q50 113 59 106 M61 106 Q70 113 77 105" fill="none" stroke="#c9cbe0" stroke-width="1.1" />
        <path d="M52 77 Q60 82 68 77" fill="none" stroke-width="1.2" />
        <text x="60" y="98" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="6.2" fill="#1b1424" stroke="none" letter-spacing="0.3">JARVIS</text>
        <path d="M60 100.6 L61.6 102.2 L60 103.8 L58.4 102.2Z" fill="#22d3ee" stroke="none" />
        <Arms />
        <path class="sleeves" d="M40 79 L30.5 95 L38.5 99.5 L45 88Z M80 79 L89.5 95 L81.5 99.5 L75 88Z" fill="#fbfbff" />
        <g class="head">
          <path d="M42 38 Q42 64 60 71 Q78 64 78 38 Q78 21 60 21 Q42 21 42 38Z" fill={SKIN} />
          <Eyes iris={iris} closed={closed} />
          <g class="brows" fill="none" stroke={hair} stroke-width="1.3" stroke-linecap="round">
            {state === 'oops' ? <><path d="M47 42.5 L56 44" /><path d="M73 42.5 L64 44" /></> : state === 'think' ? <><path d="M47 42 Q51.5 40 56 41.5" /><path d="M64 40 Q68.5 38.6 73 40" /></> : <><path d="M47 42 Q51.5 40.4 56 41.6" /><path d="M64 41.6 Q68.5 40.4 73 42" /></>}
          </g>
          <ellipse cx="47.5" cy="57.5" rx="3.4" ry="1.5" fill="#ff8fa3" opacity="0.5" stroke="none" />
          <ellipse cx="72.5" cy="57.5" rx="3.4" ry="1.5" fill="#ff8fa3" opacity="0.5" stroke="none" />
          <Mouth state={state} />
          <path class="sweat" d="M78 30 Q81 36 78.4 38.6 Q75.8 36 78 30Z" fill="#9fe3ff" stroke="#4cb8e6" stroke-width="0.8" />
          {/* Pony und Seitensträhnen: wild, spitz */}
          <path d="M38 46 Q34 16 60 13 Q86 16 82 46 L79 35 L75 44 L72 30 L66 41 L63 26 L58 40 L53 27 L49 42 L46 31 L42 41Z" fill={hair} />
          <path d="M42 30 L37 56 L41 84 L44 66 L46 48Z" fill={hair} />
          <path d="M78 30 L83 56 L79 84 L76 66 L74 48Z" fill={hair} />
          <path d="M48 20 Q58 15 70 18 M66 41 L63 29 M53 28 L56 37" fill="none" stroke={hairHi} stroke-width="1.6" stroke-linecap="round" />
          <path d="M60 13 Q62 4 70 3 Q64 8 64 14" fill={hair} />
          <g class="clip"><path d="M73 22 L80 18 L81.5 20.5 L74.5 24.5Z" fill="#22d3ee" /><circle cx="81" cy="18.6" r="1.4" fill="#e0fbff" stroke-width="0.8" /></g>
        </g>
      </g>
    </g>
  );
}

function Male({ state }) {
  const hair = '#1c2333'; const hairHi = '#46587e'; const iris = '#2fa8dd';
  const closed = state === 'sleep' || state === 'happy';
  return (
    <g stroke={OL} stroke-width="1.5" stroke-linejoin="round">
      <g class="legs">
        <g class="leg leg-l">
          <path d="M43 146 L42 238 L56 238 L59.6 152Z" fill="#283044" />
          <path d="M49 160 L48 236" fill="none" stroke="#1c2233" stroke-width="1" />
          <path d="M39 237 Q36 248 43 250 L58 250 Q60 243 56 237Z" fill="#14161d" />
        </g>
        <g class="leg leg-r">
          <path d="M77 146 L78 238 L64 238 L60.4 152Z" fill="#283044" />
          <path d="M71 160 L72 236" fill="none" stroke="#1c2233" stroke-width="1" />
          <path d="M81 237 Q84 248 77 250 L62 250 Q60 243 64 237Z" fill="#14161d" />
        </g>
      </g>
      <g class="upper">
        <rect x="55" y="62" width="10" height="16" fill={SKIN_SH} />
        {/* Hemd */}
        <path d="M37 80 Q60 72 83 80 L86 96 L80 150 L40 150 L34 96Z" fill="#fbfbff" />
        {/* Weste */}
        <path d="M44 84 L60 112 L76 84 L79 145 Q60 152 41 145Z" fill="#1f2738" />
        <path d="M60 112 L60 148" fill="none" stroke="#11151f" stroke-width="1" />
        <circle cx="60" cy="122" r="1.2" fill="#38e1ff" stroke="none" /><circle cx="60" cy="131" r="1.2" fill="#38e1ff" stroke="none" /><circle cx="60" cy="140" r="1.2" fill="#38e1ff" stroke="none" />
        <path d="M47 94 L52 94 M68 94 L73 94" fill="none" stroke="#3a4560" stroke-width="1.2" />
        <path d="M52 76 L60 84 L68 76 L66 73 L60 79 L54 73Z" fill="#fbfbff" />
        <path d="M58.2 82 L61.8 82 L62.8 102 L60 106 L57.2 102Z" fill="#22d3ee" />
        <path d="M41 145 L79 145 L79.4 150 L40.6 150Z" fill="#14161d" />
        <rect x="57.5" y="145.2" width="5" height="4.4" rx="0.8" fill="#9aa4b8" stroke-width="0.8" />
        <Arms sleeve="#fbfbff" sleeveTo={0.48} />
        <g class="head">
          <path d="M42.5 37 Q42.5 60 60 69 Q77.5 60 77.5 37 Q77.5 21 60 21 Q42.5 21 42.5 37Z" fill={SKIN} />
          <Eyes iris={iris} closed={closed} ry={4.8} cy={49} />
          <g class="brows" fill="none" stroke={hair} stroke-width="1.8" stroke-linecap="round">
            {state === 'oops' ? <><path d="M46.5 41 L56 43" /><path d="M73.5 41 L64 43" /></> : state === 'think' ? <><path d="M46.5 41.5 L56 40.6" /><path d="M64 39.4 L73.5 40.4" /></> : <><path d="M46.5 41.6 L56 40.8" /><path d="M64 40.8 L73.5 41.6" /></>}
          </g>
          <Mouth state={state} y={60} />
          <path class="sweat" d="M78 28 Q81 34 78.4 36.6 Q75.8 34 78 28Z" fill="#9fe3ff" stroke="#4cb8e6" stroke-width="0.8" />
          {/* kurze, wilde Haare */}
          <path d="M38 44 Q33 15 60 10 Q88 13 82 44 L80 34 L76.5 41 L75 28 L69 37 L66 24 L60 34 L56 23 L51 36 L47 27 L45 38 L41 32Z" fill={hair} />
          <path d="M41 32 L39 50 L42.6 46Z M79 32 L81 50 L77.4 46Z" fill={hair} />
          <path d="M47 18 Q58 12 72 15 M66 25 L68.6 34 M56 24 L56.4 32" fill="none" stroke={hairHi} stroke-width="1.6" stroke-linecap="round" />
          <g class="earpiece" stroke="none"><path d="M79 44 Q83.6 50 79 56" fill="none" stroke="#38e1ff" stroke-width="1.8" stroke-linecap="round" /><circle cx="81.6" cy="50" r="1.9" fill="#38e1ff" /><circle cx="81.6" cy="50" r="3.8" fill="#38e1ff" opacity="0.25" class="glow" /></g>
        </g>
      </g>
    </g>
  );
}

export const PET_W = 120; export const PET_H = 260;
/** Höhe der Figur bei gegebener Breite (Bilder 2 : 3, Ersatzfigur 120 : 260). */
export const petHeight = (gender, size) => Math.round(size * (PET_ART[gender]?.idle ? PET_ART_RATIO : PET_H / PET_W));

/**
 * Figur aus Bildern (eigene Zeichnungen, siehe scripts/import-pet-art.py): je Zustand ein Bild, Bewegung durch Umschalten –
 * Blinzeln (idle↔blink), Mund (talk↔idle), Laufen (walk1↔walk2) – plus Atmen/Wippen per CSS. Fehlt ein Bild, nimmt sie idle + Effekt.
 */
function PetImage({ art, state, facing, size, handlers }) {
  const [tick, setTick] = useState(0);
  const [blink, setBlink] = useState(false);
  useEffect(() => { Object.values(art).forEach((src) => { const i = new Image(); i.src = src; }); }, [art]);
  useEffect(() => {
    if (state !== 'talk' && state !== 'walk') return undefined;
    const t = setInterval(() => setTick((n) => n + 1), state === 'talk' ? 150 + Math.random() * 60 : 300);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => {
    let t; let u;
    const loop = () => { t = setTimeout(() => { setBlink(true); u = setTimeout(() => { setBlink(false); loop(); }, 140); }, 2600 + Math.random() * 3200); };
    loop();
    return () => { clearTimeout(t); clearTimeout(u); };
  }, []);
  const pick = () => {
    if (state === 'walk') return art.walk2 && tick % 2 ? art.walk2 : art.walk1 || art.idle;
    if (state === 'talk') return tick % 2 ? art.idle : art.talk || art.idle;
    if (art[state]) return art[state];
    return blink && art.blink ? art.blink : art.idle;
  };
  const h = Math.round(size * PET_ART_RATIO);
  // Nur die seitlichen Laufbilder spiegeln – sonst stünde „JARVIS“ auf dem Shirt verkehrt herum
  const fx = state === 'sleep' || (!art[state] && ['happy', 'oops', 'listen', 'wave'].includes(state));
  return (
    <div class={`pet-fig pet-img s-${state}${art[state] ? ' has-pose' : ''}`} style={{ width: size + 'px', height: h + 'px', transform: facing < 0 && state === 'walk' ? 'scaleX(-1)' : undefined }} {...handlers}>
      <div class="body"><img src={pick()} width={size} height={h} draggable={false} alt="" /></div>
      {fx && <svg class="pet-fx" viewBox="0 0 120 180" width={size} height={h}>
        <g class="zzz" fill="#cfeaf5" font-family="sans-serif" font-weight="700"><text x="84" y="22" font-size="11">z</text><text x="94" y="12" font-size="15">Z</text></g>
        <g class="waves" fill="none" stroke="#38e1ff" stroke-width="2.2" stroke-linecap="round"><path d="M92 26 Q98 34 92 42" /><path d="M98 21 Q106 34 98 47" /></g>
        <g class="sparkle" fill="#facc15"><path d="M14 30 L16 36 L22 38 L16 40 L14 46 L12 40 L6 38 L12 36Z" /><path d="M104 22 L105.5 26 L109.5 27.5 L105.5 29 L104 33 L102.5 29 L98.5 27.5 L102.5 26Z" /></g>
        <path class="sweat" d="M86 18 Q90 26 86.5 29 Q83 26 86 18Z" fill="#9fe3ff" stroke="#4cb8e6" stroke-width="0.8" />
      </svg>}
    </div>
  );
}

export function PetFigure({ gender = 'male', state = 'idle', facing = 1, size = 100, onPointerDown, onContextMenu, onMouseEnter, onMouseLeave }) {
  const art = PET_ART[gender];
  if (art?.idle) return <PetImage art={art} state={state} facing={facing} size={size} handlers={{ onPointerDown, onContextMenu, onMouseEnter, onMouseLeave }} />;
  return (
    <svg class={`pet-fig s-${state} g-${gender}`} width={size} height={Math.round(size * PET_H / PET_W)} viewBox={`0 0 ${PET_W} ${PET_H}`}
      style={{ transform: facing < 0 ? 'scaleX(-1)' : undefined }} onPointerDown={onPointerDown} onContextMenu={onContextMenu} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <ellipse cx="60" cy="251" rx="30" ry="4.5" fill="#000" opacity="0.25" class="shadow" />
      <g class="body">{gender === 'female' ? <Female state={state} /> : <Male state={state} />}</g>
      <g class="fx">
        <g class="zzz" fill="#cfeaf5" font-family="sans-serif" font-weight="700"><text x="84" y="20" font-size="9">z</text><text x="92" y="10" font-size="12">Z</text></g>
        <g class="waves" fill="none" stroke="#38e1ff" stroke-width="1.8" stroke-linecap="round"><path d="M86 42 Q91 50 86 58" /><path d="M91 37 Q98 50 91 63" /></g>
        <g class="sparkle" fill="#facc15"><path d="M16 30 L18 36 L24 38 L18 40 L16 46 L14 40 L8 38 L14 36Z" /><path d="M104 22 L105.5 26 L109.5 27.5 L105.5 29 L104 33 L102.5 29 L98.5 27.5 L102.5 26Z" /></g>
      </g>
    </svg>
  );
}

/**
 * Sprechblase neben dem Kopf: Name oben, Text darunter (Markdown), kleine Spitze Richtung Figur.
 * side: 'left' = Blase links der Figur (Strich nach rechts), 'right' = rechts der Figur (Strich nach links).
 * Bleibt bis zur nächsten Eingabe, × oder „mach die Sprechblase weg“.
 */
export function PetBubble({ bubble, html, onClose, side = 'right', name = 'JARVIS', style }) {
  if (!bubble) return null;
  return (
    <div class={`pet-bubble side-${side}${bubble.error ? ' is-error' : ''}`} style={style}>
      <div class="pet-bubble-head"><span class="pet-bubble-name">{name}</span>{onClose && <button class="pet-bubble-x" title="Sprechblase schließen" onClick={onClose}>×</button>}</div>
      {bubble.kind === 'think'
        ? <div class="pet-dots"><i /><i /><i /></div>
        : <div class="pet-bubble-text" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

/** Name in der Blase: Alya bzw. J.A.R.V.I.S. */
export const bubbleName = (settings) => (settings?.voice?.tts?.preset === 'alya' ? 'Alya' : 'J.A.R.V.I.S.');

/** Text für die Blase kürzen (Overlay kann nicht scrollen). */
export function bubbleText(t, max = 700) {
  const s = String(t || '').trim();
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '') + ' …\n\n_(Rest im Chat)_' : s;
}

export const genderFor = (settings) => (settings?.voice?.tts?.preset === 'alya' ? 'female' : 'male');
