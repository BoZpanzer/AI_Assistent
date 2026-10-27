# Kosten, Datenschutz und Aufgabenverteilung

Stand: 27.10.2026 · gilt ab JARVIS 5.0

## Leitlinie

So wenig Gemini wie möglich, so viel lokal wie sinnvoll – ohne das Spiel auszubremsen.

| Aufgabe | Verarbeitung | Warum |
|---|---|---|
| Statistiken, Zähler, Kennzahlen | **deterministisch im Code** | exakte Rechnung, kein Modell nötig |
| Raid-Ergebnis erfassen, Statistikfragen („Wie ist meine Überlebensrate heute?“) | **deterministisch**, auch per Sprache | Satzmuster lokal erkannt, 0 € |
| Kartenkalibrierung, Einstellungen, Timer, Datenabfragen | **deterministisch** | |
| Spracherkennung | **lokal** (whisper.cpp, in jedem Chat) | Audio verlässt den PC nicht |
| Sprachausgabe | **lokal**: KI-Stimme OmniVoice auf der Grafikkarte (nach Installation per Klick), sonst Piper/Windows | 0 €, nichts verlässt den PC; Gemini liefert nur Text |
| Private Nachrichten (pro Nachricht automatisch erkannt): Termine, Finanzen, Familie, eigene Daten, Assistenz-Aktionen, Anhänge | **lokales Modell** (Ollama) | kein Cloud-Fallback |
| Nicht private Nachrichten (Wissen, Uni, allgemeine Fragen), „gründliche“ Fragen, Bildschirmfrage, Websuche | **Gemini Flash**, nur wenn erlaubt – ohne private Nachrichten im Verlauf | Qualität lokal nicht erreichbar |
| Brain selbst erweitern (nach Antworten) | privat: **lokales Modell**; sonst **Gemini Sparmodell**, max. 40×/Tag | Sensibles wird nie automatisch gespeichert |
| Gaming-Nachrichten, Matchup-Karte, Gegner-Tipps, Champion-Empfehlung, Kurzfassungen | **Gemini Sparmodell** (gemini-2.5-flash-lite, 0,10/0,40 $ je 1 Mio. Token) | kurze, strukturierte Aufgaben; ca. 8× günstiger als Flash |
| Gemini Live (Echtzeit-Audio) | **aus** (Standard), optional | teuerste Funktion |

Die Entscheidung trifft zentral `Orchestrator.route()` (Chat) bzw. `Gemini.generate()` (Einzelaufrufe); erzwungen wird sie in `Gemini.cloud()` im Hauptprozess.
`Gemini.client()` funktioniert nur innerhalb dieser Pforte – ein Test prüft, dass kein anderer Code das SDK direkt benutzt.

## Modi

- **Sparsam hybrid** (Standard): Gemini nur für nicht private Nachrichten und eingeschaltete Funktionen; JARVIS ordnet jede Nachricht selbst ein (siehe unten).
- **Strikt lokal**: keine externen KI-Aufrufe. Nicht private Nachrichten werden – falls eingerichtet – vom lokalen Modell beantwortet, mit sichtbarem Hinweis.
  Umschalten: Einstellungen → Gemini / KI → Modus, oder Klick auf den Cloud-Chip oben in der Kopfzeile („Cloud pausieren“).
  Laufende Gemini-Aufrufe werden dabei abgebrochen, eine Live-Sitzung beendet.

Ist Cloud gesperrt (Modus, Funktion aus, Budget erreicht), ruft JARVIS **nie** stattdessen still ein anderes Modell oder einen anderen Anbieter auf.
Fällt das lokale Modell aus, wird **nie** automatisch Gemini benutzt.

## Sparsamer Standardmodus (Werte)

| Einstellung | Standard |
|---|---|
| Tagesbudget | 0,25 € (lokaler Kalendertag, Wechsel 00:00) |
| Kostenloser Zusatz-Schlüssel | optional; zuerst für das Sparmodell, bei erschöpftem Kontingent normaler Schlüssel mit Budget |
| Sitzungsbudget | 0,15 € (seit dem Start von JARVIS) |
| Monatsbudget | 5,00 € (Warnung 80 %, Sparstufe 95 %, Sperre 100 %) |
| Sperre bei Erreichen | an |
| Parallele Gemini-Aufrufe | max. 2 (Hintergrundaufgaben werden bei Auslastung übersprungen) |
| Ausgabelänge | max. 4 096 Token (8 192 bei Analysefragen) |
| Zeitlimit je Aufruf | 90 s |
| Chatverlauf an Gemini | letzte 10 Nachrichten / 16 000 Zeichen; Werkzeug-Antworten max. 30 000 Zeichen |
| Pro-Modell | nie automatisch (nur Modus „Immer maximal“) |
| Wiederholungen | gleiche Anfrage, gleiches Modell: 1× bei Überlastung (5xx), 1× kurzes Warten bei 429 ≤ 10 s; kein Modellwechsel |
| Abgelehnte Anfragen (4xx) | werden 1 h nicht erneut gesendet |
| Gemini Live | aus; wenn an: max. 10 min und 0,10 € je Sitzung, Audio nur bei erkannter Sprache, Leerlauf-Trennung 45 s |
| LoL-Team-Tipps in der Championauswahl | aus (ein Aufruf pro Gegner-Zusammenstellung, praktisch nie im Cache) |
| LoL-KI-Nachbesprechung, Patch-Notes-Kurzfassungen, Spielseiten gestalten | aus (per Knopf weiterhin verfügbar) |
| LoL-Matchup-/Konter-Karte | an (pro Matchup und Patch einmal, 30 Tage gespeichert) |

## Wie gezählt wird – und die Grenzen

- Vor jedem Aufruf wird eine **Schätzung reserviert** (Eingabe ≈ Zeichen / 3,5, Bilder ≈ 1 300 Token, plus maximale Ausgabe). Danach ersetzt der von Google gemeldete Verbrauch die Schätzung.
- Dadurch zählen **laufende und parallele** Aufrufe sofort mit. Nicht abgeschlossene Reservierungen (Absturz, Neustart) bleiben mit ihrer Schätzung gezählt; ein Neustart setzt das **Tagesbudget nicht zurück** (das Sitzungsbudget schon – es gilt seit dem Start).
- Gemini Live meldet Verbrauch fortlaufend; zusätzlich zählen mindestens die gestreamten Audiominuten (0,005 $/min).
- Preise: offizielle Listenpreise (bezahlter Tarif) von <https://ai.google.dev/gemini-api/docs/pricing>, abgerufen am 19.10.2026, in **USD**. Angekündigte Erhöhungen (gemini-3.8-flash ab 01.01.2027, gemini-4-argon ab 01.12.2026) sind hinterlegt. Unbekannte Modelle werden wie Pro berechnet.
- Euro: Umrechnung mit dem einstellbaren Kurs (Standard 0,86 €/$, **Annahme**, kein Tageskurs).
- Die lokale Sperre ist **keine garantierte Abrechnungsobergrenze**: Google zählt selbst (eigene Zeitzone, Rundung, Suchgebühren über 5 000/Monat, Preisänderungen), und ein bereits laufender Aufruf kann eine Grenze noch überschreiten. Für eine harte Obergrenze das Ausgabenlimit im Google AI Studio verwenden; JARVIS ändert daran nichts.
- „Echten Stand aus AI Studio eintragen“ eicht die Monatsschätzung.

Verbrauchsprotokoll (`ai_ledger`): Zeitpunkt, Funktion, Modell, Token, geschätzte Kosten – **keine Inhalte, keine Screenshots, keine Schlüssel**. Einstellungen → Gemini / KI → „Kosten letzte 7 Tage“.

## Ursachenanalyse ~5 € in 1–2 Tagen

Historische Abrechnungsdaten liegen in dieser Umgebung nicht vor, deshalb lassen sich die 5 € **nicht exakt zuordnen**. Belegt aus dem Code (Stand 4.3.0):

1. **Gemini Live streamte das Mikrofon ununterbrochen** (auch Stille und Spielsound) zu 3 $ / 1 Mio. Audio-Token; jede Antwort rechnete bis zu ~24 000 Token Sitzungskontext neu. Spielgeräusche erzeugten Transkripte, die den 90-s-Leerlauf-Timer immer wieder verlängerten – die Sitzung blieb offen, solange gespielt wurde. Eine Zeit- oder Kostengrenze je Sitzung gab es nicht.
2. **Automatisches Durchprobieren von bis zu 5 Modellen inkl. Pro** bei 429/503 sowie ein Warten und erneutes Senden im Minutenlimit.
3. **Automatisches Pro-Modell** für alles, was nach Analyse klang, mit hoher Denktiefe (Ausgabe 12 $ / 1 Mio. Token).
4. **Hintergrund-KI ohne Nutzeraktion:** Team-Tipps bei jeder Championauswahl (Cache-Trefferquote ≈ 0), KI-Nachbesprechung nach jedem Spiel, Patch-Notes-Kurzfassungen, automatische Spielseiten (mit Google-Suche).
5. Die alte Kostenschätzung nutzte zu niedrige Flash-Preise (0,50/3,00 statt 0,75/3,75 $) und warnte nur, sperrte aber nie.

Vermutung, nicht belegt: der größte Anteil stammt aus Punkt 1. Nach dem Update zeigt „Kosten letzte 7 Tage“ die tatsächliche Verteilung.

## Datenflüsse

| Daten | Aufnahme | Ziel | Speicherung | Abschalten |
|---|---|---|---|---|
| Mikrofon (lokal) | nur nach Mikrofon-Taste/Wake-Word, endet nach Sprechpause | whisper.cpp auf dem PC | temporäre WAV, sofort gelöscht | Mikrofon nicht drücken / Wake-Word aus |
| Mikrofon (Gemini Live) | nur wenn Funktion an + Zustimmung je Sitzung; nur bei erkannter Sprache | Google | nicht von JARVIS | Funktion „Gemini Live“ aus (Standard) |
| Transkript / Chattext | aus Eingabe | pro Nachricht: privat → lokal, sonst Gemini (ohne private Nachrichten) | lokale Datenbank (Gesprächsverlauf) | Gespräch löschen; Modus „Strikt lokal“ |
| Bildschirm | nur Hotkey/Frage, **nur während ein Spiel aktiv ist**, bevorzugt nur das Spielfenster, max. 1 600 px; Tarkov-Itemscan nur Ausschnitt um den Mauszeiger | Gemini (Gaming-Chat des Spiels) | **standardmäßig nicht gespeichert** | Einstellungen → Sicherheit; Funktion „Bildschirmanalyse“ aus |
| Spieldaten (LoL-Matches, Tarkov-Log, Statistik) | Client/Log/Riot-API | lokal; an Gemini nur in Gaming-Chats bzw. LoL nach Freigabe „LoL-Daten für Cloud“ | lokale Datenbank | Freigabe aus; Statistik-Einträge löschen |
| Öffentliche Spieldaten (json.tarkov.dev bzw. api.tarkov.dev, Data Dragon, Steam-News) | Abruf | Drittanbieter (kein Personenbezug außer IP) | Cache (Ablaufzeit) | Einstellungen → Sicherheit → Spieldaten-Cache löschen |
| Goon-Meldung | nur per Knopf | tarkov.dev (mit Tarkov-Account-ID) | – | Knopf nicht nutzen |
| Diagnose-Protokolle | laufend | lokal, Schlüssel/Token geschwärzt, max. 8 MB | `logs/` | Einstellungen → Sicherheit → Protokolle leeren |
| JARVIS-Kalender (Termine, Geburtstage, Uni, Aufgaben mit Fälligkeit, Erinnerungen) | nur wenn „Alles aus JARVIS nach Google übertragen“ an ist; letzte 30 bis nächste 180 Tage | Google Kalender (eigene Kalender „JARVIS · …“ je Art) | bei Google | Schalter aus bzw. Art abwählen (entfernt unveränderte Kopien) |
| Vorgelesene Antworten | jede Sprachantwort | **lokal** (OmniVoice/Piper) | Audio-Cache lokal (max. 60 MB) | – |
| Lokale KI-Stimme (Installation) | nur per Klick | Downloads von GitHub (uv), python.org-Builds, PyTorch, PyPI, Hugging Face (Modell) | `omnivoice/` im Datenordner (ca. 6 GB) | Einstellungen → Lokale KI-Stimme → Entfernen |
| Brain-Lernschritt | nach Antworten | privat: lokal; sonst Gemini Sparmodell (nur dieser Austausch) | Brain (lokal) | Einstellungen → „Brain selbstständig erweitern“ aus; Einträge im Brain löschen |
| Kostenloses Kontingent (Zusatz-Schlüssel) | Sparmodell-Anfragen | Google; darf laut Google zur Produktverbesserung genutzt werden | – | Schlüssel entfernen |
| Kosten-Protokoll | je Gemini-Aufruf | lokal, nur Metadaten | Datenbank | ältere Einträge löschen |

Sichtbarkeit: Die Kopfzeile zeigt den Cloud-Zustand (aus / an mit laufenden Aufrufen und Tagesstand / gesperrt), ein aktives Mikrofon (lokal oder Gemini Live) und jede Bildschirmaufnahme.

**Lokale Modellserver:** JARVIS spricht Ollama nur über `127.0.0.1` an (kein DNS, kein Proxy, keine Weiterleitung, keine `:cloud`-Modelle). Ollama selbst lauscht standardmäßig nur auf `127.0.0.1:11434`; ist `OLLAMA_HOST` auf eine andere Adresse gesetzt (z. B. `0.0.0.0`), zeigt JARVIS eine Warnung. Empfehlung: `OLLAMA_HOST=127.0.0.1:11434`. JARVIS kann die Konfiguration des separat installierten Ollama-Dienstes nicht erzwingen.

**Keine Telemetrie** in JARVIS. Netzwerkzugriffe: Gemini (nur über die Pforte), Hugging Face/PyTorch/PyPI (nur beim Laden einer Stimme bzw. der KI-Stimme per Klick), Google Kalender/Drive (nach Freigabe), Riot, tarkov.dev, Steam, DB-Fahrplan, GitHub-Updates.

Grenzen: Ein Spielfenster kann selbst private Inhalte zeigen (z. B. In-Game-Chat). Fenstererkennung erfolgt über den Fenstertitel; wird kein Spielfenster gefunden, wird der Bildschirm unter dem Mauszeiger aufgenommen (in der Kopfzeile sichtbar). Was Google mit übertragenen Daten macht, regeln Googles Bedingungen.
