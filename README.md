# JARVIS 3 – Personal Intelligence System

Persönlicher KI-Assistent für Windows: privater Chat über lokales Ollama, freigegebener Uni-/Gaming-Chat über Gemini, Aufgaben & Routinen, lokaler Kalender mit Google-Import, Studienunterlagen aus OneDrive/Goodnotes, ein langfristiges Brain, Webrecherche und eine Gaming-Oberfläche, die sich dem aktuellen Spiel anpasst.

**Installation für Endnutzer:** `JARVIS_Setup.exe` ausführen – keine Administratorrechte, kein Python, kein Node.js nötig. Beim ersten Start führt ein Assistent durch die Einrichtung (für private KI ist ein lokal installiertes Ollama-Modell nötig; Gemini ist für freigegebene Cloud-Chats optional).

---

## Inhalt

1. [Architektur](#architektur)
2. [Funktionen](#funktionen)
3. [Einrichtung](#einrichtung)
4. [Daten, Sicherheit, Datenschutz](#daten-sicherheit-datenschutz)
5. [Entwickeln, Testen, Bauen](#entwickeln-testen-bauen)
6. [Bekannte Grenzen](#bekannte-grenzen)

Weitere Dokumente: [TESTBERICHT.md](TESTBERICHT.md) · [MIGRATION.md](MIGRATION.md) · [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md) · [docs/UPDATES.md](docs/UPDATES.md)

---

## Architektur

**Technologie: Electron 44 (Chromium 152, Node 24), modularer Monolith in JavaScript.** Begründung der Wahl gegenüber WinUI/WPF/Qt (Vorgänger 2.0 war PySide6):

| Kriterium | Ergebnis |
|---|---|
| Designtreue zu den HUD-Schemata (Glow, Graph, Karte, Orb) | Web-Rendering setzt sie 1:1 um; Qt-Widgets nur mit großem Aufwand |
| Barge-in / Unterbrechen | Chromium liefert Echo-Unterdrückung (AEC), Rauschunterdrückung und AGC fürs Mikrofon – der Vorgänger mit PortAudio hatte keine AEC |
| Kein lokaler Webserver | UI ↔ Logik über abgesicherte IPC, Oberfläche über das private Schema `app://` |
| Keine nativen Module | SQLite + FTS5 kommen aus `node:sqlite` (in Electron enthalten) → reproduzierbarer Build, auch Cross-Build von Linux |
| Ressourcen | ~150–250 MB RAM. Animationen werden beim Minimieren/Spielen gedrosselt bzw. pausiert; schwere Hintergrundjobs pausieren während eines Spiels |

```
src/
  main/                    Hauptprozess (Node) – gesamte Geschäftslogik
    index.js               Desktop-Host: Fenster, Tray, Autostart, Hotkeys, app://-Protokoll + CSP, Smoke-Test
    ipc.js                 einzige RPC-Schnittstelle zur Oberfläche (explizite Methoden, Absenderprüfung)
    preload.js             minimale Brücke (rpc, Events, Audio-Kanal) – kein Node im Renderer
    app-core.js            Composition Root (ohne Electron → vollständig testbar)
    core/                  DB + Migrationen, Einstellungen, Secrets (DPAPI), Validierung, Bestätigungen, Wiederholungsregeln, Logger
    providers/             Gemini (Modellerkennung, Streaming, Embeddings, Recherche, PDF-Seitenanalyse), Google OAuth + Kalender-REST
    agent/                 EIN Orchestrator + Werkzeugregister + gemeinsamer Systemprompt
    voice/live.js          Gemini-Live-Sitzung (gleiche Werkzeuge & Historie wie der Chat)
    services/              tasks, calendar, brain, vectors, study (+ extract-Worker), web, conversations, notifications, system, gaming/*
    jobs/scheduler.js      ein kooperativer Scheduler statt vieler Hintergrundschleifen
  renderer/                Oberfläche (Preact, gebündelt mit esbuild)
    src/pages/             Dashboard, Chat, Aufgaben, Kalender, Studium, Gaming (+ Widget-Renderer), Brain, Einstellungen, Setup
    audio/                 AudioWorklets (Aufnahme 16 kHz, Wiedergabe 24 kHz), Wake-Word-Worker (openWakeWord/ONNX)
tests/                     Unit-, Integrations-, Sprach-, Wake-Word- und Electron-E2E-Tests
build/                     Icons, NSIS-Installer-Skript
scripts/                   Renderer-Build, Icon-Generator, Windows-Build (exe + Installer)
```

**Ein Orchestrator für alles.** Chat, Dashboard-Chat, Sprachmodus und Hintergrundjobs nutzen dieselben geprüften Services (`calendar.create`, `tasks.complete`, …) und dasselbe Werkzeugregister. Jedes Werkzeug hat ein Eingabeschema, das vor der Ausführung validiert wird. Änderungen mit Tragweite (Kalender, Löschen, Einstellungen) erzeugen eine **Bestätigungskarte**: Einmal-Token, 3 Minuten gültig, vor der Ausführung verbraucht (keine Doppelausführung). Das Modell selbst kann nichts bestätigen – im Sprachmodus nur, wenn deine letzte Äußerung eindeutig „Ja“ war.

**Modelle werden nie fest verdrahtet.** Beim Einrichten listet JARVIS über `models.list` alle Modelle, die dein Schlüssel nutzen darf, und wählt pro Rolle (schnell, Reasoning, Recherche, multimodal, Live, Embeddings) das passende. `gemini-3.8-live` und `gemini-3.8-live-extended-thinking` werden dabei ausdrücklich geprüft und angezeigt.

## Funktionen

- **Dashboard:** holografischer Orb (Bereitschaft/Zuhören/Denken/Sprechen, reagiert auf Mikro- und Ausgabepegel, ohne Beschriftungen), darunter der Chat. Klick auf den Orb startet/stoppt den Sprachmodus.
- **Chat:** mehrere Gespräche, Streaming, Markdown inkl. Tabellen/Code, Datei-Anhänge (werden indexiert und sind per `read_document` lesbar), Quellenchips, Aktions- und Bestätigungskarten mit „Rückgängig“, Suche, Markdown-Export, Vorlesen. Die Chatleiste mit Mikrofon, Anhängen, Recherche und kontextspezifischen Aktionen gibt es auf jeder Seite.
- **Sprache:** Gemini Live mit Voll-Duplex, Barge-in (lokal sofort + serverseitiges `interrupted`), Session-Resumption, GoAway-Reconnect, Kontextkompression, Standby nach Stille, Stummschaltung, globale Taste (Standard `Strg+Alt+Leertaste`), optional **lokales Wake-Word „Hey Jarvis“** (openWakeWord, läuft offline – Audio verlässt den PC erst nach Erkennung), optionaler Startsound.
- **Aufgaben & Routinen:** Prioritäten, Kategorien, Fristen, Unteraufgaben, Notizen, Dateien/Links, Wiederholungen (täglich/wöchentlich mit Wochentagen/monatlich/jährlich), Erinnerungen, Verlauf, Schnelleingabe („Abgabe morgen 14:00 !hoch #Studium“).
- **Kalender:** Monats-/Wochenansicht, lokale Termine, Google Kalender (OAuth 2.0 + PKCE, Zwei-Wege-Sync mit Warteschlange bei Offline, Konflikterkennung mit Auflösung, Zeitzonen, Serien), freie Zeitfenster → Lernpläne mit einer gemeinsamen Bestätigung.
- **Studium:** OneDrive-Ordner wird überwacht; PDF/DOCX (inkl. Word-Formeln)/PPTX/MD/TXT/IPYNB werden inkrementell indexiert (Datei- und Seitenprüfsummen, Duplikaterkennung, Fächer aus Ordnern). Goodnotes-Handschrift ohne Textebene wird erkannt und auf Abruf (oder automatisch mit Tageslimit) von Gemini transkribiert – Ergebnis per Seitenprüfsumme gecacht. Lernwerkzeuge: Zusammenfassen, Erklären, Lernfragen, Quiz, Lernkarten, Lernplan – mit Seitenzitaten.
- **Brain:** Wissensbereiche (Persönliches, Projekte, Studium, Wissen, Erinnerungen, Ideen, Quellen, Technologie, Gaming), Hybrid-Suche (FTS5 + semantische Vektoren + Quellen-/Konfidenzgewichtung), Duplikaterkennung, Ersetzen geänderter Fakten mit Verlauf, Widerspruchserkennung, Gültigkeitsdaten, Archiv, Zusammenführen ähnlicher Einträge, manuelle Korrektur. Sensible Themen werden nicht automatisch gespeichert. Graph-, Listen- und Clusteransicht mit echten Daten.
- **Webrecherche:** Google-Suche über Gemini mit Quellen; Webseiten dauerhaft speichern (versioniert, wöchentliche Aktualisierung möglich). Webinhalte sind Daten, nie Anweisungen; nur öffentliche https-Adressen (SSRF-Schutz).
- **Gaming:** Game Context Engine (aktives vs. besprochenes Spiel; Aussage/manuelle Wahl > Prozess > zuletzt bestätigt), Widget-Renderer mit festem Widget-Katalog (das Modell wählt nur Typ + validierte Parameter, erzeugt nie HTML/JS).
  - *Escape from Tarkov:* interaktive Karte (Zoom, Verschieben, Vollbild, Marker in 6 Kategorien, bearbeiten/löschen/rückgängig, Filter, Routen, eigenes Kartenbild, Kalibrierung → Exits/Schlösser aus tarkov.dev einblenden), Raid-Hilfe (Exits, Schlüssel, Bosse), Quests, Items/Keys mit Preisen, Raid-Checkliste. Keine Live-Raid-Daten – wird so angezeigt.
  - *League of Legends:* Live-Match (Live Client Data API), Ranglisten-Statistik (Winrate, KDA, CS/min, Vision, Champions, Rollen, Trends) und Rang **direkt aus dem laufenden League-Client – ohne API-Schlüssel** (lokale Client-Schnittstelle, alle 10 Min. solange der Client offen ist; pausiert während eines Matches). Riot-Web-API nur optional. Insights, Trainingsziele, Championinfos (Data Dragon). Nur lesend, keine Automatisierung.
  - *Rise of Kingdoms:* Bau-/Forschungs-/Trainings-Timer („mein Rathaus braucht noch fünf Stunden“), Entwicklungsplanung, Recherche mit Quellen, Notizen.
  - *Alle anderen Spiele (ARK, Elden Ring, …):* universelle Oberfläche – Recherche mit Quellen, Wiki (wo eine öffentliche MediaWiki-API existiert), Notizen, Timer, gespeicherte Quellen.
  - „Andere Spiele – Benachrichtigungen“ mit Herkunft (eigener Timer = Zeitabschätzung).
  - **Mein Spielstand (ab 3.1):** JARVIS merkt sich deinen Fortschritt pro Spiel, sobald du davon erzählst („hab Operation Aquarius abgeschlossen“, „Sun Tzu ist jetzt Level 40“, „bin PMC-Level 34“). Gleiche Einträge werden aktualisiert (mit Verlauf und „Rückgängig“), Tarkov-Quests werden auf die offiziellen Namen abgebildet und in der Quest-Liste abgehakt. Der Stand des aktiven, des besprochenen und jedes im Satz erwähnten Spiels fließt automatisch in jede Antwort ein – andere Spiele nicht (spart Tokens). Bei einem Wipe wird der alte Stand archiviert.
  - **In-Game-Overlay (ab 3.3):** transparentes, klick-durchlässiges HUD über dem Spiel (Timer, Spielstand, Mini-Karte, Sprachstatus, Antworten, LoL-Championauswahl/Nachbesprechung). Strg+Alt+O ein/aus, Strg+Alt+I kurz bedienen. Funktioniert im Modus „Randloses Fenster“.
  - **„Was ist das?“ (Strg+Alt+W):** Screenshot nur auf ausdrücklichen Wunsch → Frage an Gemini → Antwort im Overlay. Bilder bleiben lokal (die letzten 20).
  - **TarkovTracker-Sync (ab 3.3):** persönlicher API-Token → erledigte Quests/PMC-Level automatisch im Spielstand; Abhaken in JARVIS wird mit Schreibrecht zurückübertragen.
  - **LoL Championauswahl & Nachbesprechung (ab 3.3):** Matchup-Tipps nur anhand der Champions (Riot-Richtlinie: keine Spielerdaten in der Lobby), Nachbesprechung nach jedem Spiel aus echten Zahlen.
- **Proaktiv:** Tagesbriefing, Erinnerungen, Hinweis auf Überfälliges, Ruhezeiten, Kategorien abschaltbar.
- **Desktop:** eigenes Fenster und Icon, Startmenü, optional Desktop-Verknüpfung, System-Tray (Schließen = weiterlaufen, „vollständig beenden“ im Tray-Menü), Autostart, Benachrichtigungen, Sicherung/Wiederherstellung, **Ein-Klick-Updates aus GitHub Releases** (Button „Aktualisieren“, signiert, mit Sicherung, stille Installation, Neustart – siehe [docs/UPDATES.md](docs/UPDATES.md)), Deinstallation (fragt, ob persönliche Daten gelöscht werden sollen; Standard: behalten).

## Einrichtung

1. **Gemini:** Schlüssel unter <https://aistudio.google.com/app/apikey> erstellen und im Assistenten einfügen. Hinweis: Ein Google-AI-Abo ist kein API-Kontingent.
2. **Google Kalender (optional):** einmalig einen OAuth-Client vom Typ *Desktop-App* anlegen – Schritt für Schritt in [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md).
3. **Studium (optional):** den OneDrive-Ordner wählen, in den Goodnotes exportiert.
4. **League of Legends:** nichts einzurichten – einfach den League-Client starten. Ein Riot-API-Schlüssel ist nur nötig, wenn du Statistiken auch ohne geöffneten Client aktualisieren willst.

## Daten, Sicherheit, Datenschutz

- **Daten:** `%APPDATA%\JARVIS` (Datenbank `jarvis.sqlite3`, Karten, Sicherungen, Protokolle) – getrennt vom Programmordner `%LOCALAPPDATA%\Programs\JARVIS`, bleibt bei Updates erhalten. Täglich automatische Sicherung (7 Tage), zusätzlich vor jeder Schema-Migration und vor Updates.
- **Geheimnisse** (Gemini-, Riot-Schlüssel, Google-Token) werden mit Electron `safeStorage` = **Windows DPAPI** (an deinen Windows-Benutzer gebunden) verschlüsselt, erreichen nie die Oberfläche und werden in Protokollen geschwärzt.
- **Keine offenen Ports.** Kein lokaler Webserver. Nur während einer Google-Anmeldung lauscht kurz ein Loopback-Endpunkt auf einem Zufallsport (OAuth-Standard für Desktop-Apps, mit `state` + PKCE).
- **Renderer gehärtet:** Sandbox, contextIsolation, strikte CSP, Navigations- und Fenstersperre, nur Mikrofon-Berechtigung, IPC prüft den Absender.
- **Werkzeuge:** Schema-Validierung, Bestätigung für kritische Aktionen, keine Systembefehle, keine Ausführung von Modell-Code.
- **Dokumente** werden in einem isolierten Worker mit Zeitlimit geparst (pdf.js ohne eval/Fonts/XFA).
- **Mikrofon:** Gemini Live ist gesperrt, damit private Sprache nicht vor einer Prüfung den PC verlässt. Das Wake-Word läuft lokal; lokale Spracherkennung ist noch nicht eingerichtet.

## Entwickeln, Testen, Bauen

```bash
npm ci                    # gepinnte Abhängigkeiten (package-lock.json)
npm run dev               # Renderer bauen + App starten
npm test                  # Unit/Integration/Sprache/Wake-Word (node:test)
npm run test:e2e          # echte Electron-App, Klick-Tests + Screenshots (tests/e2e/screens)
npm run dist:win          # release/win-unpacked/JARVIS.exe + release/JARVIS_Setup.exe
JARVIS.exe --smoke        # Selbsttest der gebauten/installierten App (Exit-Code 0 = OK)
```

`dist:win` funktioniert auf Windows (NSIS installieren: `choco install nsis`) und als Cross-Build auf Linux (`apt install nsis`). Icon und Versionsinfo werden mit `resedit` ohne Wine eingebettet. GitHub-Actions: `tests.yml` (jeder Push, Linux, alle Tests), `windows.yml` (PR/manuell: Windows-Build, Smoke-Test, stille Installation/Start/Deinstallation), `release.yml` (Tag `v*`: Build, Signatur, GitHub-Release für den Update-Button).

## Bekannte Grenzen

Ehrliche, vollständige Liste mit Teststatus: **[TESTBERICHT.md](TESTBERICHT.md)**. Kurz: Gemini Live, Google OAuth, Riot/tarkov.dev-Abrufe und die echte Windows-Installation sind implementiert und gegen Fakes/Mocks getestet, aber noch nicht mit deinen echten Konten auf deinem PC abgenommen. Die Installer-Datei ist nicht code-signiert (Windows SmartScreen zeigt beim ersten Start eine Warnung).


## Private, lokale KI und neue Planung

Einrichtung, Datenschutzgrenzen, geplante Ausgaben-Buckets und Tarkov-Ziele: [Anleitung](docs/PRIVATE_LOCAL.md).


### Offline-Tarkov-Karten

Zwölf Wiki-Karten liegen im Programm und werden beim Öffnen des Kartenwidgets lokal bereitgestellt. Die Varianten „Wiki“ haben eigene Ziele, Marker und Routen; bestehende SVG-Karten werden nicht ersetzt. Terminal ist nicht enthalten. Quellen und Lizenz: [Kartennachweise](src/main/assets/tarkov-wiki/ATTRIBUTION.md).

Die Wiki-Bilder sind **nicht vollständig vorkalibriert**. Unter „Kalibrieren“ drei weit auseinanderliegende Punkte auf der Hauptkarte zuordnen: einen Exit aus der Liste auswählen und seine Position anklicken, alternativ Spielkoordinaten eingeben. JARVIS berechnet daraus automatisch die affine Umrechnung einschließlich Spiegelung und unterschiedlicher Skalierung. Keine separaten Stockwerk-Inserts verwenden; das Ergebnis an weiteren Landmarken prüfen. Ohne passende Referenzen bleiben API-Positionen ausgeblendet. Die separat ladbaren SVG-Karten besitzen weiterhin ihre vorhandene automatische Kalibrierung.

Beim Austausch eines Kartenbilds wird die alte Kalibrierung entfernt. Die Testfälle prüfen Offline-Import, getrennte Routen/Ziele, degenerierte Referenzpunkte und den Datenschutz ohne Cloud-Ausweichpfad. Die früheren Tests für Cloud-Kalender-Schreibzugriffe, Live-Audio und vollständige Drive-Backups prüfen jetzt deren Sperre; lokale KI-Tests verwenden einen separaten Fake sowie einen echten Loopback-HTTP-Test.
