/**
 * JARVIS als kleine Chibi-Figur (eigene Gestaltung, reines SVG, ca. 1 : 2,4 Kopf zu Körper).
 * gender: 'male' (J.A.R.V.I.S./Standard: Butler im Frack, Headset-Monokel) | 'female' (Alya: Hoodie, lange Haare).
 * state: idle | walk | talk | think | listen | wave | happy | sleep | oops – die Animationen stecken in styles/pet.css.
 */
const SKIN = '#fde4d2'; const SKIN_SH = '#f3c9b1'; const LINE = '#3b2a2a';

function Eyes({ iris, lash, closed }) {
  if (closed) {
    return (
      <g class="eyes-closed" fill="none" stroke={lash} stroke-width="2.4" stroke-linecap="round">
        <path d="M40 61 Q47 66 54 61" /><path d="M66 61 Q73 66 80 61" />
      </g>
    );
  }
  const eye = (cx) => (
    <g>
      <ellipse cx={cx} cy="61" rx="7.2" ry="8.6" fill="#fff" />
      <ellipse cx={cx} cy="62" rx="5.8" ry="7.2" fill={iris} />
      <ellipse cx={cx} cy="64.5" rx="5.2" ry="4" fill="#000" opacity="0.18" />
      <ellipse cx={cx} cy="62.5" rx="2.7" ry="3.8" fill="#14121c" />
      <circle cx={cx + 2.2} cy="58.2" r="2" fill="#fff" />
      <circle cx={cx - 2.2} cy="65.2" r="1" fill="#fff" opacity="0.9" />
      <path d={`M${cx - 8.4} 56 Q${cx} 49.5 ${cx + 8.4} 55`} fill="none" stroke={lash} stroke-width="2.6" stroke-linecap="round" />
    </g>
  );
  return <g class="eyes">{eye(47)}{eye(73)}</g>;
}

function Face({ iris, lash, brow, state }) {
  const closed = state === 'sleep' || state === 'happy';
  return (
    <g class="face">
      <ellipse cx="29.5" cy="62" rx="4.6" ry="6.6" fill={SKIN_SH} />
      <ellipse cx="90.5" cy="62" rx="4.6" ry="6.6" fill={SKIN_SH} />
      <path d="M29 52 Q29 86 60 89 Q91 86 91 52 Q91 22 60 22 Q29 22 29 52Z" fill={SKIN} />
      <Eyes iris={iris} lash={lash} closed={closed} />
      <g fill="none" stroke={brow} stroke-width="1.8" stroke-linecap="round" class="brows">
        {state === 'oops' ? <><path d="M40 49 L53 52" /><path d="M80 49 L67 52" /></> : state === 'think' ? <><path d="M40 50 Q47 46 53 49" /><path d="M67 47 Q73 45 80 47" /></> : <><path d="M40 49 Q47 46 53 48" /><path d="M67 48 Q73 46 80 49" /></>}
      </g>
      <ellipse cx="40" cy="71.5" rx="5" ry="2.4" fill="#ff8fa3" opacity="0.45" />
      <ellipse cx="80" cy="71.5" rx="5" ry="2.4" fill="#ff8fa3" opacity="0.45" />
      <circle cx="60" cy="70" r="0.9" fill={SKIN_SH} />
      <g class="mouth-closed"><path d={state === 'oops' ? 'M55 78 Q60 75 65 78' : 'M55 76 Q60 80 65 76'} fill="none" stroke={LINE} stroke-width="1.6" stroke-linecap="round" /></g>
      <g class="mouth-open"><path d="M55.5 75.5 Q60 74.5 64.5 75.5 Q64 81.5 60 82 Q56 81.5 55.5 75.5Z" fill="#7a2e3a" /><path d="M57 80 Q60 78 63 80 Q61.5 81.6 60 81.7 Q58.5 81.6 57 80Z" fill="#ff8a8a" /></g>
      <path class="sweat" d="M86 40 Q90 47 86.5 50 Q83 47 86 40Z" fill="#9fe3ff" stroke="#5cc8f0" stroke-width="0.8" />
    </g>
  );
}

function Male({ state }) {
  const coat = '#1f2a3c'; const coatHi = '#2c3b55'; const hair = '#1b2232'; const hairHi = '#3a4a6a';
  return (
    <>
      <g class="legs">
        <g class="leg leg-l"><rect x="47" y="128" width="11" height="30" rx="4" fill="#2b3445" /><ellipse cx="51.5" cy="160" rx="8" ry="4" fill="#111827" /></g>
        <g class="leg leg-r"><rect x="62" y="128" width="11" height="30" rx="4" fill="#2b3445" /><ellipse cx="68.5" cy="160" rx="8" ry="4" fill="#111827" /></g>
      </g>
      <g class="upper">
        <path d="M40 126 L33 152 L50 138Z M80 126 L87 152 L70 138Z" fill={coat} />
        <g class="arm arm-l"><rect x="33" y="94" width="11" height="30" rx="5.5" fill={coat} /><rect x="33.5" y="120" width="10" height="4" rx="2" fill="#f8fafc" /><circle cx="38.5" cy="128" r="5" fill={SKIN} /></g>
        <path d="M38 93 Q60 85 82 93 L86 131 Q60 138 34 131Z" fill={coat} />
        <path d="M52 90 L60 112 L68 90Z" fill="#f8fafc" />
        <path d="M52 90 L60 112 L45 100Z M68 90 L60 112 L75 100Z" fill={coatHi} />
        <path d="M57.6 92 L62.4 92 L63.6 105 L60 110.5 L56.4 105Z" fill="#22d3ee" />
        <circle cx="60" cy="119" r="1.7" fill="#38e1ff" /><circle cx="60" cy="126" r="1.7" fill="#38e1ff" />
        <rect x="55" y="83" width="10" height="9" rx="3" fill={SKIN_SH} />
        <g class="head">
          <Face iris="#3aa7d8" lash="#1b2232" brow={hair} state={state} />
          <path d="M26 58 Q22 18 60 14 Q98 18 94 58 Q92 44 86 37 Q84 44 76 45 Q78 38 74 33 Q64 43 46 40 Q50 36 49 32 Q38 40 31 47 Q28 52 26 58Z" fill={hair} />
          <path d="M40 26 Q56 18 74 22" fill="none" stroke={hairHi} stroke-width="2.4" stroke-linecap="round" />
          <path d="M74 33 Q70 41 62 43" fill="none" stroke={hairHi} stroke-width="1.6" stroke-linecap="round" />
          <g class="earpiece"><path d="M93 54 Q99 62 93 70" fill="none" stroke="#38e1ff" stroke-width="2.2" stroke-linecap="round" /><circle cx="95.5" cy="62" r="2.4" fill="#38e1ff" /><circle cx="95.5" cy="62" r="4.5" fill="#38e1ff" opacity="0.25" class="glow" /></g>
        </g>
        <g class="arm arm-r"><rect x="76" y="94" width="11" height="30" rx="5.5" fill={coat} /><rect x="76.5" y="120" width="10" height="4" rx="2" fill="#f8fafc" /><circle cx="81.5" cy="128" r="5" fill={SKIN} /></g>
      </g>
    </>
  );
}

function Female({ state }) {
  const hair = '#6b3a2a'; const hairHi = '#9a5a40'; const hood = '#b7a6ec'; const hoodSh = '#9c8ad8';
  return (
    <>
      <path class="hair-back" d="M27 52 Q18 108 32 132 Q46 136 60 128 Q74 136 88 132 Q102 108 93 52 Q93 18 60 16 Q27 18 27 52Z" fill={hair} />
      <g class="legs">
        <g class="leg leg-l"><rect x="49" y="134" width="9" height="24" rx="4" fill="#2a2d3a" /><path d="M43.5 160 Q44 155 52 155 Q59 155 59 160 Q59 163 52 163 Q44 163 43.5 160Z" fill="#f8fafc" /><path d="M46 159 L57 159" stroke="#22d3ee" stroke-width="1.4" /></g>
        <g class="leg leg-r"><rect x="62" y="134" width="9" height="24" rx="4" fill="#2a2d3a" /><path d="M61 160 Q61 155 68 155 Q76 155 76.5 160 Q76 163 68 163 Q61 163 61 160Z" fill="#f8fafc" /><path d="M63 159 L74 159" stroke="#22d3ee" stroke-width="1.4" /></g>
      </g>
      <g class="upper">
        <path d="M38 122 L82 122 L89 140 Q60 147 31 140Z" fill="#2c3550" />
        <path d="M48 125 L45 141 M60 125 L60 143 M72 125 L75 141" stroke="#1f2740" stroke-width="1.4" />
        <g class="arm arm-l"><rect x="33" y="93" width="11.5" height="30" rx="5.75" fill={hood} /><rect x="33.5" y="119" width="10.5" height="4.5" rx="2.2" fill={hoodSh} /><circle cx="38.75" cy="127.5" r="4.8" fill={SKIN} /></g>
        <path d="M37 93 Q60 84 83 93 L86 125 Q60 131 34 125Z" fill={hood} />
        <path d="M46 116 Q60 120 74 116 L72.5 124 Q60 127 47.5 124Z" fill={hoodSh} />
        <path d="M60 106.5 L63.5 110 L60 113.5 L56.5 110Z" fill="none" stroke="#22d3ee" stroke-width="1.5" />
        <path d="M55 94 L54 106 M65 94 L66 106" stroke="#f8fafc" stroke-width="1.3" stroke-linecap="round" />
        <circle cx="54" cy="107" r="1.4" fill="#f8fafc" /><circle cx="66" cy="107" r="1.4" fill="#f8fafc" />
        <path d="M45 87 Q60 99 75 87 Q71 82.5 60 85 Q49 82.5 45 87Z" fill={hoodSh} />
        <rect x="55.5" y="82" width="9" height="8" rx="3" fill={SKIN_SH} />
        <g class="head">
          <Face iris="#8b6cf0" lash="#3a1e18" brow={hair} state={state} />
          <path d="M26 60 Q24 20 60 17 Q96 20 94 60 Q90 46 85 41 L81 51 Q76 38 67 36 L64 47 Q57 36 48 38 L45.5 49 Q41 41 34 45 Q29 51 26 60Z" fill={hair} />
          <path d="M28 54 Q24 80 30 100 Q33 108 30 114 Q38 108 36 96 Q33 80 34 60Z" fill={hair} />
          <path d="M92 54 Q96 80 90 100 Q87 108 90 114 Q82 108 84 96 Q87 80 86 60Z" fill={hair} />
          <path d="M38 26 Q55 18 76 23" fill="none" stroke={hairHi} stroke-width="2.4" stroke-linecap="round" />
          <path d="M31 66 Q30 84 33 98" fill="none" stroke={hairHi} stroke-width="1.4" stroke-linecap="round" />
          <g class="clip"><rect x="76" y="29" width="11" height="3.6" rx="1.8" transform="rotate(-24 81.5 30.8)" fill="#22d3ee" /><circle cx="85.5" cy="27.8" r="1.5" fill="#e0fbff" /></g>
        </g>
        <g class="arm arm-r"><rect x="75.5" y="93" width="11.5" height="30" rx="5.75" fill={hood} /><rect x="76" y="119" width="10.5" height="4.5" rx="2.2" fill={hoodSh} /><circle cx="81.25" cy="127.5" r="4.8" fill={SKIN} /></g>
      </g>
    </>
  );
}

export function PetFigure({ gender = 'male', state = 'idle', facing = 1, size = 120, onPointerDown, onContextMenu, onMouseEnter, onMouseLeave }) {
  return (
    <svg class={`pet-fig s-${state} g-${gender}`} width={size} height={size * 170 / 120} viewBox="0 0 120 170"
      style={{ transform: facing < 0 ? 'scaleX(-1)' : undefined }} onPointerDown={onPointerDown} onContextMenu={onContextMenu} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <ellipse cx="60" cy="163" rx="30" ry="4.5" fill="#000" opacity="0.22" class="shadow" />
      <g class="body">{gender === 'female' ? <Female state={state} /> : <Male state={state} />}</g>
      <g class="fx">
        <g class="zzz" fill="#cfeaf5" font-family="sans-serif" font-weight="700"><text x="92" y="30" font-size="10">z</text><text x="100" y="20" font-size="13">Z</text></g>
        <g class="waves" fill="none" stroke="#38e1ff" stroke-width="2" stroke-linecap="round"><path d="M101 54 Q106 62 101 70" /><path d="M106 49 Q113 62 106 75" /></g>
        <g class="sparkle" fill="#facc15"><path d="M20 30 L22 36 L28 38 L22 40 L20 46 L18 40 L12 38 L18 36Z" /><path d="M100 26 L101.5 30 L105.5 31.5 L101.5 33 L100 37 L98.5 33 L94.5 31.5 L98.5 30Z" /></g>
      </g>
    </svg>
  );
}

/** Sprechblase: „denkt …“ oder die Antwort (Markdown). Bleibt, bis die nächste Eingabe kommt. */
export function PetBubble({ bubble, html, onClose, tail = 'down', style }) {
  if (!bubble) return null;
  return (
    <div class={`pet-bubble tail-${tail}`} style={style}>
      {onClose && <button class="pet-bubble-x" title="Schließen" onClick={onClose}>×</button>}
      {bubble.kind === 'think'
        ? <div class="pet-dots"><i /><i /><i /></div>
        : <div class="pet-bubble-text" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

/** Text für die Blase kürzen (Overlay kann nicht scrollen). */
export function bubbleText(t, max = 700) {
  const s = String(t || '').trim();
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '') + ' …\n\n_(Rest im Chat)_' : s;
}

export const genderFor = (settings) => (settings?.voice?.tts?.preset === 'alya' ? 'female' : 'male');
