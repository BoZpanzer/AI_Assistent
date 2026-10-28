import { useEffect, useRef, useState } from 'preact/hooks';
import { useEvent, rpc } from './api.js';
import { bubbleText } from '../components/Pet.jsx';

/**
 * Was die Figur gerade tut – gemeinsam für Desktop und Overlay.
 * Ereignisse aus dem Hauptprozess: pet:input (neue Eingabe), pet:delta / pet:answer (Antwort, live bzw. fertig),
 * pet:signal (hört zu / spricht – kommt vom Hauptfenster), overlay:thinking / overlay:answer (Bildschirmfragen).
 * Die Blase bleibt stehen, bis die nächste Eingabe kommt.
 */
export function usePetMood({ max = 700 } = {}) {
  const [bubble, setBubble] = useState(null);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [flash, setFlash] = useState(null); // 'happy' | 'oops' kurz nach der Antwort
  const msg = useRef(null);
  const flashTimer = useRef(null);
  const showFlash = (f) => { clearTimeout(flashTimer.current); setFlash(f); flashTimer.current = setTimeout(() => setFlash(null), 1800); };
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const input = (d) => { msg.current = d?.messageId || null; setFlash(null); setBubble({ kind: 'think' }); };
  useEvent('pet:input', input);
  useEvent('overlay:thinking', input);
  useEvent('pet:delta', (d) => {
    if (msg.current && d.messageId && msg.current !== d.messageId) return;
    msg.current = d.messageId || msg.current;
    if (d.text) setBubble({ kind: 'text', text: bubbleText(d.text, max) });
  });
  useEvent('pet:answer', (d) => {
    if (msg.current && d.messageId && msg.current !== d.messageId) return;
    if (d.text) setBubble({ kind: 'text', text: bubbleText(d.text, max), error: !!d.error });
    showFlash(d.error ? 'oops' : 'happy');
  });
  useEvent('overlay:answer', (d) => { if (d?.answer) { setBubble({ kind: 'text', text: bubbleText(d.answer, max) }); showFlash(/^⚠️/.test(d.answer) ? 'oops' : 'happy'); } });
  // Von dir geschlossen (× oder „mach die Sprechblase weg“) → closed zählt hoch (Desktop-Figur läuft zurück an den Rand)
  const [closed, setClosed] = useState(0);
  // Standby: Figur schläft, bis „Hey Jarvis“ oder eine neue Nachricht kommt
  const [standby, setStandby] = useState(false);
  useEffect(() => { rpc('voice.state').then((v) => setStandby(!!v?.standby)).catch(() => {}); }, []);
  useEvent('voice:standby', (d) => { setStandby(!!d.on); if (d.on) { msg.current = null; setBubble(null); } else showFlash('wave'); });
  const close = () => { msg.current = null; setBubble(null); setClosed((n) => n + 1); };
  useEvent('pet:clear', close);
  useEvent('pet:signal', (d) => {
    if (d.kind === 'speaking') setSpeaking(!!d.on);
    if (d.kind === 'listening') { setListening(!!d.on); if (d.on) { msg.current = null; setBubble(null); } }
  });

  const state = speaking ? 'talk' : standby ? 'sleep' : listening ? 'listen' : bubble?.kind === 'think' ? 'think' : flash || 'idle';
  return { state, bubble, speaking, listening, flash, closed, close, standby, clear: () => setBubble(null) };
}
