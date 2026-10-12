'use strict';
/**
 * Deterministic stand-in for @google/genai used ONLY in automated UI tests
 * (no network, no API key). It exercises the real orchestrator/tool path.
 */
function lastUserText(contents) {
  for (let i = contents.length - 1; i >= 0; i--) {
    const c = contents[i];
    if (c.role !== 'user') continue;
    const t = c.parts.map((p) => p.text || '').join('');
    if (t) return { text: t, afterTools: c.parts.some((p) => p.functionResponse) };
    if (c.parts.some((p) => p.functionResponse)) return { text: '', afterTools: true, responses: c.parts.map((p) => p.functionResponse) };
  }
  return { text: '' };
}

class GoogleGenAI {
  constructor() {
    this.models = {
      list: async () => (async function* () { for (const n of ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3.8-live', 'gemini-3.8-live-extended-thinking', 'gemini-embedding-2']) yield { name: 'models/' + n, supportedActions: ['generateContent'] }; })(),
      generateContentStream: async ({ contents }) => {
        const last = contents[contents.length - 1];
        const fr = last.parts.filter((p) => p.functionResponse).map((p) => p.functionResponse);
        let parts;
        if (fr.length) {
          const r = fr[0];
          if (r.name === 'get_today_overview') {
            const o = r.response;
            parts = [{ text: `Hier ist dein Überblick für **${o.date}**, Chef:\n\n| Bereich | Stand |\n|---|---|\n| Termine | ${o.events.length ? o.events.map((e) => e.title).join(', ') : 'keine'} |\n| Fällige Aufgaben | ${o.tasksDue.length} |\n| Überfällig | ${o.overdue} |\n| Spiel-Timer | ${o.gameTimers.length} |\n\n- Wichtigste Aufgabe: ${o.tasksDue[0]?.title || '—'}\n- Tipp: Plane einen Fokusblock am Vormittag.` }];
          } else if (r.name === 'create_event') parts = [{ text: 'Ich habe den Termin vorbereitet – bitte kurz bestätigen.' }];
          else if (r.name === 'set_game_context') parts = [{ text: `Alles klar, ${r.response.game} ist jetzt dein aktives Spiel. Die Gaming-Seite ist angepasst.` }];
          else parts = [{ text: 'Erledigt.' }];
        } else {
          const t = (lastUserText(contents).text || '').toLowerCase();
          if (/heute|steht.*an/.test(t)) parts = [{ functionCall: { id: 'f1', name: 'get_today_overview', args: {} } }];
          else if (/trag|termin/.test(t)) { const d = new Date(Date.now() + 86400000); d.setHours(16, 0, 0, 0); parts = [{ functionCall: { id: 'f2', name: 'create_event', args: { title: 'Mathe lernen', start: d.toISOString(), end: new Date(d.getTime() + 5400000).toISOString() } } }]; }
          else if (/spiele|zocke/.test(t)) parts = [{ functionCall: { id: 'f3', name: 'set_game_context', args: { game: t.includes('tarkov') ? 'Escape from Tarkov' : t.includes('league') ? 'League of Legends' : 'ARK', mode: 'playing' } } }];
          else parts = [{ text: 'Verstanden. (Testmodus ohne echte Gemini-Verbindung)' }];
        }
        return (async function* () { for (const p of parts) { if (p.text) for (const ch of p.text.match(/[\s\S]{1,24}/g)) yield { candidates: [{ content: { parts: [{ text: ch }] } }] }; else yield { candidates: [{ content: { parts: [p] } }] }; } })();
      },
      generateContent: async () => ({ text: 'Testantwort', candidates: [{ groundingMetadata: {} }] }),
      embedContent: async ({ contents }) => ({ embeddings: contents.map(() => ({ values: Array.from({ length: 16 }, (_, i) => Math.sin(i)) })) }),
    };
    // Fake Gemini Live: after ~1 s of microphone audio it answers with 1 s of 24 kHz tone + transcripts.
    this.live = {
      connect: async ({ callbacks }) => {
        let chunks = 0; let answered = false;
        const stats = (global.__fakeLive = { audioChunks: 0, answered: 0, closed: false });
        setTimeout(() => callbacks.onopen?.(), 5);
        return {
          sendRealtimeInput: ({ audio }) => {
            stats.audioChunks = ++chunks;
            if (!answered && chunks >= 12 && audio?.mimeType === 'audio/pcm;rate=16000') {
              answered = true; stats.answered++;
              callbacks.onmessage({ serverContent: { inputTranscription: { text: 'Hallo Jarvis' } } });
              const pcm = Buffer.alloc(24000 * 2);
              for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 24000 * 2 * Math.PI * 440) * 8000), i * 2);
              for (let k = 0; k < 4; k++) setTimeout(() => callbacks.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm.subarray(k * 12000, (k + 1) * 12000).toString('base64') } }] }, outputTranscription: k === 0 ? { text: 'Hallo Chef, ich höre dich.' } : undefined } }), 50 + k * 30);
              setTimeout(() => callbacks.onmessage({ serverContent: { turnComplete: true } }), 1400);
            }
          },
          sendClientContent: () => {},
          sendToolResponse: () => {},
          close: () => { stats.closed = true; },
        };
      },
    };
  }
}
module.exports = { GoogleGenAI };
