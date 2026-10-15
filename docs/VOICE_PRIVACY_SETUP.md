# Sprache in JARVIS: Private offline, Uni/Gaming auf Wunsch in Gemini Live

## Warum das Mikrofon vorher blockiert war

Die bestehende Gemini-Live-Funktion wurde bisher in jedem Chatmodus sofort gesperrt, um private Gesprächsdaten zu schützen. Diese Änderung teilt die Aufnahme nach Gesprächsmodus auf.

## Private · lokal

1. Installiere **whisper.cpp** aus dem offiziellen Projekt `ggml-org/whisper.cpp` lokal auf Windows und stelle die ausführbare Datei `whisper-cli.exe` bereit. Eine selbst installierte, vertrauenswürdige Engine ist erforderlich; JARVIS lädt kein ausführbares Programm automatisch herunter.
2. Lade ein **mehrsprachiges** GGML-Modell (beispielsweise `ggml-base.bin` oder `ggml-small.bin`) aus den offiziellen whisper.cpp-Modellquellen. Englische `.en`-Modelle sind für Deutsch ungeeignet.
3. Öffne JARVIS → **Einstellungen → Sprache** und wähle zuerst `whisper-cli.exe`, anschließend das Modell `.bin`.
4. Wähle **Private · lokal**, drücke das Mikrofon, sprich bis zu 30 Sekunden und drücke es erneut.
5. Audio wird in einem temporären Ordner auf dem PC an `whisper-cli` übergeben. JARVIS löscht WAV und Transkript danach. Nur der erkannte Text wird in den privaten JARVIS-Chat übernommen.

Die Erkennung ist zunächst **Push-to-Talk / Diktat**, nicht ein voll-duplex Live-Dialog. Whisper.cpp und das Modell sind **nicht** im JARVIS-Installer enthalten. Der Text wird entsprechend der bereits bestehenden privaten JARVIS-Chat-Regeln lokal weiterverarbeitet; es gibt keinen Cloud-Fallback. Ein vom Nutzer selbst installiertes fremdes CLI-Programm muss vertrauenswürdig sein.

## Uni · Cloud und Gaming · Cloud

Vor jeder neuen Live-Sitzung fragt JARVIS ausdrücklich:

- Das Mikrofon-Audio wird an **Google Gemini** übertragen.
- Antworten und freigegebene Chat-Historie werden cloudbasiert verarbeitet.
- Erst nach Zustimmung wird das Mikrofon für Gemini Live gestartet.

Der Hauptprozess erlaubt Gemini Live ausschließlich für Gesprächsmodi `study` und `gaming` und verlangt `cloudAudioApproved === true`. Ein Wechsel der aktiven Unterhaltung beendet die laufende Übertragung auf Renderer-Seite; ein Wechsel der Sitzung selbst zu `private` beendet sie außerdem im Hauptprozess. Direkte IPC-Aufrufe können diese Prüfungen nicht umgehen.

## Tests

- Privater Modus / fehlende Cloud-Zustimmung erzeugen **keine** Live-Verbindung.
- Auch während einer bestehenden Live-Sitzung bleibt der Datenschutz-Check aktiv.
- Bei nachträglichem Private-Tag wird die Cloud-Sitzung beendet und keine weiteren Audio-Frames werden gesendet.
- Lokales PCM16 / WAV: Samplingrate, Begrenzungen, fehlerhafte Daten.
- Whisper-Aufruf mit `shell:false`, temporäre WAV-Datei, Transkript und Aufräumen nach Erfolg oder Fehler.

Die CI-Tests verwenden für die lokale Engine einen Mock-Prozess. Ein vollständiger Mikrofon- und Deutsch-Erkennungstest erfordert eine echte Windows-Installation mit whisper.cpp-Modell.
