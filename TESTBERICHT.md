# Testbericht JARVIS 3.0.0

Stand: 12. Oktober 2026 · Build-Umgebung: Linux x64 (Container), Node 22 / Electron 44.7.0 (Chromium 152, Node 24), Xvfb ohne GPU.
**Es stand keine Windows-Maschine zur Verfügung.** `JARVIS.exe` und `JARVIS_Setup.exe` wurden per Cross-Build erzeugt und strukturell geprüft, aber nicht auf Windows ausgeführt. Die GitHub-Action `.github/workflows/windows.yml` holt genau diese Prüfung (Build, Smoke-Test, stille Installation, Start, Deinstallation) auf einem echten Windows-Runner nach.

## Ergebnisse

| Testart | Ergebnis |
|---|---|
| Unit-/Integrationstests (`npm test`, node:test) | **29 / 29 bestanden** |
| Electron-E2E mit echter Oberfläche (`npm run test:e2e`) | **13 / 13 Schritte bestanden**, keine Renderer-Fehler, 17 Screenshots |
| Smoke-Test `--smoke` (Dev-Build, 8 Wiederholungen) | 8 / 8 (nach Behebung eines Start-Race, s. u.) |
| Smoke-Test der **gepackten** App (asar, Linux-Paket, gleicher Code wie Windows) | alle Schritte bestanden außer „Sichere Schlüsselablage“ (DPAPI gibt es nur unter Windows – erwartet) |
| Windows-Artefakte | PE x64, GUI-Subsystem, Icon (7 Größen) + Versionsinfo eingebettet, Asar-Integritätsressource erhalten; Installer: NSIS 3.09, per-User, mit Uninstaller |

**Durch Tests gefundene und behobene Fehler:** Endlosschleife im Markdown-Renderer bei halb gestreamten Tabellen (UI-Hänger) · Race im UI-Store, durch das die Oberfläche in ~1 von 4 Starts auf „JARVIS startet …“ stehen blieb · Race zweier gleichzeitiger Selbsttests · Kalender-Konflikte wurden beim nächsten Pull überschrieben · Preact 11 setzt keine `px`-Einheiten mehr (→ Preact 10) · teurer Hintergrund-Weichzeichner (53 % → 13 % CPU).

## Messwerte (Linux, Software-Rendering ohne GPU – auf Windows mit Grafikkarte niedriger)

| Messung | Wert |
|---|---|
| UI bereit nach Programmstart | ≈ 0,6 s |
| Arbeitsspeicher (alle 4 Prozesse) | ≈ 470–530 MB (Software-Rendering; mit GPU typischerweise deutlich weniger) |
| CPU Dashboard im Leerlauf, Orb-Animation „Standard“ | ≈ 11–13 % eines Kerns (CPU-Rendering) |
| CPU mit Animationen „Aus“ | ≈ 4 % |
| Orb beim Spielen / minimiert | 12 fps bzw. pausiert; Hintergrundjobs (Embeddings, Scans, Seitenanalysen) pausieren während eines Spiels |
| Vektorsuche 20 000 × 768 Dimensionen | ≈ 45 ms |
| Brain-Volltextsuche (FTS5, 2 000 Einträge) | ≈ 4 ms |
| Installer / installierte Größe | 105 MB / ≈ 360 MB (davon 235 MB Electron-Laufzeit) |

## Status je Anforderung

Legende: **A** = automatisiert getestet · **E2E** = in der echten Oberfläche getestet · **F** = nur mit Fakes/Mocks bzw. Testdaten geprüft · **W** = Prüfung auf Windows/echter Hardware/echten Konten steht aus · **–** = nicht umgesetzt

| Bereich | Status | Anmerkung |
|---|---|---|
| Desktop-Fenster, eigenes Icon, Fenstersteuerung | E2E (Linux), W | |
| System-Tray, Schließen = weiterlaufen, „vollständig beenden“ | E2E (Tray-Erzeugung), W | Tray-Menü-Klicks nicht automatisiert |
| Autostart, globale Tastenkürzel, Windows-Benachrichtigungen | implementiert, W | Electron-APIs, unter Linux nicht aussagekräftig |
| Installer, Startmenü, Desktop-Verknüpfung, Deinstallation (Daten optional behalten) | gebaut + strukturell geprüft, W | CI-Workflow testet still: Installieren → Starten → Deinstallieren |
| Keine Python/Node-Installation nötig | ✓ (alles im Paket) | |
| Datenbank, Migrationen, Sicherung vor Migration, Wiederherstellung | A | |
| Daten bleiben bei Updates erhalten | A (Daten getrennt vom Programmordner) | Update-Installation selbst: W |
| Signierte Update-Prüfung | A | Kein Update-Server/Schlüssel eingerichtet (siehe docs/UPDATES.md) |
| UI nach Schemata (8 Seiten, Navigation, Header ohne Modus, rechte Spalte, Chatleiste überall) | E2E | Screenshots in `tests/e2e/screens` |
| Orb (Zustände, Mikro-/Ausgabepegel, Drosselung, abschaltbar) | E2E | |
| Chat (Streaming, Markdown, Gespräche, Suche, Export, Anhänge, Quellen, Bestätigungen, Vorlesen) | A + E2E mit Fake-Gemini | echte Gemini-Antworten: W |
| Gemini-Modellerkennung über `models.list` | A (Fake) | `gemini-3.8-live(-extended-thinking)` laut Google-Changelog GA seit 15.09.2026; mit deinem Schlüssel: W |
| Orchestrator, Werkzeugschemata, Bestätigungspflicht, Einmal-Token | A | |
| Gemini Live: Verbindung, gleiche Werkzeuge/Historie, Unterbrechung, Resumption, GoAway, Extended Thinking, Sprach-Bestätigungsschutz | A (Fake-Live) | |
| Sprachkette Mikrofon → Worklet → IPC → Live → Wiedergabe → Transkript | E2E mit Fake-Mikrofon + Fake-Live | Latenz/Echo/Barge-in mit echter Stimme: **W** |
| Wake-Word „Hey Jarvis“ (lokal) | A: synthetische Sprache en-US/en-GB erkannt (Score 0,99), keine Fehlauslösung bei 2 Negativproben; Modelle laden in der gepackten App | Mit deiner Stimme/deinem Mikrofon: W. Deutsch ausgesprochenes „Dschar-wis“ kann schlechter erkannt werden (Modell ist englisch trainiert) |
| Push-to-Talk, Stummschaltung, Standby, Startsound | implementiert, W | PTT ist ein Umschalter (globale Tasten liefern unter Windows kein Loslassen-Ereignis) |
| Aufgaben, Unteraufgaben, Routinen, Erinnerungen, Historie, Anhänge | A + E2E | |
| Kalender lokal (Serien, freie Slots) | A + E2E | |
| Google Kalender: OAuth, Zwei-Wege-Sync, Warteschlange, Konflikte | A (Fake-Google-API) | Echte Anmeldung/Smartphone-Sync: **W** – braucht deinen OAuth-Client (docs/GOOGLE_SETUP.md) |
| Studium: Ordnerüberwachung, inkrementelle Indexierung, PDF/DOCX/PPTX/MD/TXT/IPYNB, Duplikate, Seitenzitate | A (PDF/MD) | DOCX/PPTX/IPYNB-Parser implementiert, nicht mit echten Dateien getestet; OneDrive-Ordner: W |
| Handschrift/Formeln per Gemini-Seitenanalyse mit Cache | implementiert, F | mit echten Goodnotes-PDFs: W |
| Brain: Duplikate, Ersetzen, Widersprüche, Gültigkeit, Archiv, Zusammenführen, Hybrid-Suche, Graph/Liste/Cluster | A + E2E | Semantik mit echten Gemini-Embeddings: W |
| Webrecherche (Gemini + Google-Suche), Seiten speichern & versionieren, SSRF-Schutz | A (Fake) | echte Recherche: W |
| Game Context Engine (aktiv vs. besprochen, Prozess, Vorrang manuell) | A + E2E | Prozesserkennung unter Windows (`tasklist`): W |
| Widget-Renderer mit festem Katalog | A + E2E | |
| Tarkov: Karte, Marker, Routen, Kalibrierung, Raid-Hilfe, Quests, Keys | A (Fake tarkov.dev) + E2E | Live-Daten von api.tarkov.dev: W (Container hatte keinen Zugriff). Kein Kartenmaterial mitgeliefert – eigenes Bild importieren |
| League: Live-Client, Riot-Statistik, Insights, Ziele, Data Dragon | A (Statistik) | echte Riot-API/Live-Match: W |
| Rise of Kingdoms: Timer, Planung, Recherche | A + E2E | |
| Universelle Spiele (ARK, Elden Ring …), Wiki-Anbindung | E2E | |
| Benachrichtigungen anderer Spiele mit Herkunft | A + E2E | |
| Proaktiv: Briefing, Überfälliges, Ruhezeiten | A (Ruhezeiten, Dedupe) | |
| Einrichtungsassistent (8 Schritte) | E2E (Schritte 1–2) | Restliche Schritte manuell: W |
| Altdaten-Import aus JARVIS 2.0 | A | mit deiner echten alten Datenbank: W |
| Sicherheit (CSP, Sandbox, IPC-Absender, keine Ports, DPAPI, Log-Schwärzung, Prompt-Injection-Hinweise, PDF-Worker) | A (Validierung, Schwärzung, SSRF, Bestätigungen) | DPAPI: W |

## Nicht umgesetzt (bewusst ehrlich)

- **ARK-Zähmungsrechner / Betäubungsmunition / Futterberechnung:** Keine verlässliche, lizenzierte Datenquelle mit Kreaturwerten → statt eines möglicherweise falschen Rechners beantwortet JARVIS solche Fragen über Recherche/Wiki **mit Quellen**.
- **Rise-of-Kingdoms-Kommandanten-Datenbank:** keine offizielle API → Recherche mit Quellen + deine eigene Planung.
- **Google Drive als zusätzliche Quelle / Google Docs als Ausgabe:** nicht umgesetzt (OneDrive-Pipeline ist die Hauptquelle).
- **Tarkov-Kartenbilder:** nicht mitgeliefert (Nutzungsrechte) – eigenes Bild importieren; mit Kalibrierung werden Exits/Schlösser aus tarkov.dev eingeblendet.
- **Authenticode-Signatur** der EXE (braucht ein Zertifikat) – SmartScreen warnt beim ersten Start.
- **Sitzung nach Inaktivität sperren:** nicht umgesetzt (deshalb auch kein Schalter dafür).

## Reproduktion

```bash
npm ci && npm test                     # 29 Tests
npm run test:e2e                       # 13 E2E-Schritte, Screenshots unter tests/e2e/screens
npm run dist:win                       # release/JARVIS_Setup.exe
release\win-unpacked\JARVIS.exe --smoke   # unter Windows: Bericht in %TEMP%\jarvis-smoke-report.json
```

## Abnahme-Checkliste auf deinem PC (≈ 15 Minuten)

1. `JARVIS_Setup.exe` installieren → SmartScreen „Weitere Informationen → Trotzdem ausführen“ → Startmenü-Eintrag vorhanden.
2. Assistent: Gemini-Schlüssel → Modellprüfung zeigt `gemini-3.8-live` als verfügbar?
3. Mikrofon-Test, Ton-Test, „Hey Jarvis“ aktivieren.
4. Orb anklicken, sprechen: „Jarvis, was steht heute an?“ – Antwort per Stimme? Während der Antwort dazwischenreden → stoppt sie sofort?
5. „Trag morgen um 16 Uhr Mathe lernen ein“ → Karte bestätigen → Termin auf dem Smartphone sichtbar (nach Google-Verbindung).
6. OneDrive-Ordner wählen → Dokumente erscheinen unter Studium → Frage zu einer Mitschrift beantwortet mit Seitenzitat?
7. Tarkov/LoL starten → Gaming-Seite wechselt automatisch? CPU-Last von JARVIS im Task-Manager beim Spielen?
8. Fenster schließen → Tray-Symbol bleibt; Tray → „vollständig beenden“.

---

## Nachtrag 3.1.0 – Spielstand (13. Oktober 2026)

Neu: persönlicher Spielstand pro Spiel (Werkzeuge `update_game_progress`, `get_game_progress`, `reset_game_progress`), Widget „Mein Spielstand“, Häkchen bei erledigten Tarkov-Quests, Schema-Migration v1 → v2.

| Test | Ergebnis |
|---|---|
| Unit/Integration inkl. 5 neuer Spielstand-Tests (Aktualisieren statt Duplikat, Rückgängig, Wipe, Kontext nur für relevante Spiele, Größenbegrenzung bei 300 Quests, Orchestrator-Flow, Migration einer 3.0.0-Datenbank mit Sicherung) | **34 / 34 bestanden** |
| E2E: „Sun Tzu ist jetzt Level 40 und das Rathaus Stufe 22“ → gespeichert, im Widget sichtbar, im Systemprompt enthalten | **14 / 14 Schritte bestanden** |
| Mit echtem Gemini (ob das Modell zuverlässig von selbst speichert) | **W** – hängt vom Modellverhalten ab; fehlt mal etwas, hilft „Jarvis, merk dir …“ oder das Widget |
