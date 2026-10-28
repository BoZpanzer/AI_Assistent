import os, sys, json, time, subprocess
sys.path.insert(0, 'src/main/voice')
os.environ['JARVIS_TTS_TOKEN'] = 'x'; os.environ['JARVIS_TTS_DEVICE'] = 'cpu'; os.environ['JARVIS_TTS_REFS'] = '/tmp/refs'
os.makedirs('/tmp/refs', exist_ok=True)
import omnivoice_server as S
t = json.load(open('probe-tts/text.json'))
S.load()
jobs = [
  ('KI-Stimme_JARVIS', dict(text=t['said'], ref='jarvis-1', ref_audio='src/main/voice/refs/jarvis.wav', ref_text=t['refText'], steps=16)),
  ('KI-Stimme_Alya', dict(text=t['said'], ref='alya-1', ref_audio='src/main/voice/refs/alya.wav', ref_text=t['refText'], steps=16)),
  ('KI-Stimme_Standard', dict(text=t['said'], ref='standard-1', instruct='male, young adult, moderate pitch', seed=1, steps=16)),
]
for name, req in jobs:
    t0 = time.time(); w = S.synth(req); open(f'probe-tts/{name}.wav', 'wb').write(w); print(name, round(time.time()-t0, 1), 's', flush=True)
