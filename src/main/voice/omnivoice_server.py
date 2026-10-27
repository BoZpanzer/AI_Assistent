# JARVIS – lokale Stimme mit OmniVoice (k2-fsa, Apache-2.0 Code / CC-BY-NC Modell).
# Läuft nur auf 127.0.0.1, verlangt ein Zufallstoken (Umgebungsvariable JARVIS_TTS_TOKEN).
# POST /tts {text, instruct, ref, seed, speed, language} -> audio/wav (24 kHz, 16 bit mono)
# Für eine gleichbleibende Stimme: Beim ersten Satz eines Profils wird einmalig eine Referenz aus der
# Beschreibung (instruct + seed) erzeugt und gespeichert; alle weiteren Sätze klonen diese Referenz.
import io, json, os, sys, threading, time, wave, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get('JARVIS_TTS_TOKEN', '')
REF_DIR = os.environ.get('JARVIS_TTS_REFS', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'refs'))
DEVICE = os.environ.get('JARVIS_TTS_DEVICE', 'auto')
MODEL_ID = os.environ.get('JARVIS_TTS_MODEL', 'k2-fsa/OmniVoice')
REF_TEXT = 'Hallo, ich bin dein Assistent. Ich helfe dir heute gerne bei allem, was ansteht, und sage dir kurz Bescheid.'
SR = 24000

lock = threading.Lock()
model = None
prompts = {}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def load():
    global model, DEVICE
    import torch
    from omnivoice import OmniVoice
    if DEVICE == 'auto':
        DEVICE = 'cuda:0' if torch.cuda.is_available() else 'cpu'
    dtype = torch.float16 if DEVICE.startswith('cuda') else torch.float32
    t = time.time()
    model = OmniVoice.from_pretrained(MODEL_ID, device_map=DEVICE, dtype=dtype)
    log('model loaded on', DEVICE, round(time.time() - t, 1), 's')


def to_wav(samples):
    import numpy as np
    a = np.clip(np.asarray(samples, dtype='float32'), -1.0, 1.0)
    pcm = (a * 32767.0).astype('<i2').tobytes()
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm)
    return buf.getvalue()


def ref_path(ref):
    safe = re.sub(r'[^a-zA-Z0-9_-]', '_', ref)[:60] or 'default'
    return os.path.join(REF_DIR, safe + '.wav')


def reference(ref, instruct, seed, language):
    """Referenz-Audio für ein Profil (einmalig aus der Beschreibung erzeugt)."""
    import torch, soundfile as sf
    p = ref_path(ref)
    if not os.path.exists(p):
        os.makedirs(REF_DIR, exist_ok=True)
        torch.manual_seed(int(seed))
        a = model.generate(text=REF_TEXT, language=language, instruct=instruct)[0]
        sf.write(p, a, SR)
        prompts.pop(ref, None)
        log('reference created', ref)
    if ref not in prompts:
        try:
            prompts[ref] = model.create_voice_clone_prompt(ref_audio=p, ref_text=REF_TEXT)
        except Exception as e:  # ältere Versionen: direkt mit ref_audio/ref_text
            log('clone prompt fallback', repr(e)[:200])
            prompts[ref] = None
    return p


def synth(req):
    text = str(req.get('text') or '').strip()[:1500]
    if not text:
        raise ValueError('kein Text')
    language = req.get('language') or 'de'
    instruct = str(req.get('instruct') or 'male, young adult, moderate pitch')[:200]
    ref = str(req.get('ref') or 'default')
    seed = int(req.get('seed') or 1)
    speed = req.get('speed')
    kw = {'text': text, 'language': language}
    if speed:
        kw['speed'] = max(0.6, min(1.6, float(speed)))
    ref_audio = req.get('ref_audio'); ref_text = req.get('ref_text')
    with lock:
        if ref_audio and ref_text and os.path.exists(str(ref_audio)):
            # feste Vorlage (mitgelieferte Stimme) statt Beschreibung
            if ref not in prompts:
                try: prompts[ref] = model.create_voice_clone_prompt(ref_audio=str(ref_audio), ref_text=str(ref_text))
                except Exception as e: log('clone prompt fallback', repr(e)[:200]); prompts[ref] = None
            p = str(ref_audio)
        else:
            p = reference(ref, instruct, seed, language)
            ref_text = REF_TEXT
        if prompts.get(ref) is not None:
            kw['voice_clone_prompt'] = prompts[ref]
        else:
            kw['ref_audio'] = p; kw['ref_text'] = ref_text
        t = time.time()
        a = model.generate(**kw)[0]
        log('synth', len(text), 'chars', round(time.time() - t, 2), 's')
    return to_wav(a)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype='application/json'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authed(self):
        return TOKEN and self.headers.get('X-Token') == TOKEN

    def do_GET(self):
        if not self.authed():
            return self.send(403, b'{"error":"forbidden"}')
        if self.path == '/health':
            return self.send(200, json.dumps({'ok': model is not None, 'device': DEVICE}).encode())
        self.send(404, b'{}')

    def do_POST(self):
        if not self.authed():
            return self.send(403, b'{"error":"forbidden"}')
        try:
            n = int(self.headers.get('Content-Length') or 0)
            if n > 100000:
                return self.send(413, b'{"error":"zu gross"}')
            req = json.loads(self.rfile.read(n) or b'{}')
            if self.path == '/tts':
                return self.send(200, synth(req), 'audio/wav')
            if self.path == '/forget':
                ref = str(req.get('ref') or '')
                with lock:
                    prompts.pop(ref, None)
                    try: os.remove(ref_path(ref))
                    except FileNotFoundError: pass
                return self.send(200, b'{"ok":true}')
            self.send(404, b'{}')
        except Exception as e:
            log('error', repr(e)[:500])
            self.send(500, json.dumps({'error': str(e)[:300]}).encode())


def main():
    if not TOKEN:
        log('JARVIS_TTS_TOKEN fehlt'); sys.exit(2)
    load()
    srv = ThreadingHTTPServer(('127.0.0.1', 0), H)
    print('READY', srv.server_address[1], DEVICE, flush=True)
    # Beendet sich, wenn JARVIS weg ist (stdin geschlossen)
    def watch():
        try:
            sys.stdin.read()
        finally:
            os._exit(0)
    threading.Thread(target=watch, daemon=True).start()
    srv.serve_forever()


if __name__ == '__main__':
    main()
