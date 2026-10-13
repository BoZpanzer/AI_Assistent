# Changelog

Jeder Abschnitt `## x.y.z` erscheint als Changelog im Update-Dialog von JARVIS.

## 3.13.0 – LoL-Fehleranalyse aus deinen Ranked-Spielen

- **JARVIS schaut sich deine Ranked-Spiele im Detail an**, über die Spiel-Timelines aus dem League-Client (ohne API-Schlüssel) oder optional die Riot-API. Pro Spiel wertet es aus:
  - jeden Tod mit Minute und Ort auf der Karte (Fluss, gegnerischer Jungle, Lane …) und ob es ein 1-gegen-1 war oder du in Unterzahl warst
  - die Lane-Phase gegen deinen direkten Gegner: CS, Gold und XP bei 10 und 15 Minuten
  - Objectives: Warst du bei euren Drachen und Baronen dabei? Bist du gestorben, kurz bevor der Gegner einen geholt hat?
  - Vision und Kontrollwards
- **Fehlermuster über die letzten 20 Spiele**, z. B. „Zu viele frühe Tode“, „Tode im Fluss/gegnerischen Jungle“, „In Niederlagen schlechtere Lane-Phase (CS@10 72 gegen 58)“ oder „Tode kurz vor gegnerischen Objectives“. Jeder Befund steht mit Zahlen da, und es wird nur verglichen, was in deinen eigenen Spielen steckt. Unter 3 Spielen stellt JARVIS keine Behauptungen auf.
- Neues Widget **„Fehleranalyse“** auf der LoL-Seite. Die Muster stehen außerdem als eigener Eintrag im Brain und werden automatisch aktualisiert.
- Im Chat: „Was mache ich falsch?“ oder „Analysiere meine Ranked-Spiele“ nutzt diese Daten. Die Nachbesprechung nach jedem Spiel nennt jetzt auch deine Tode mit Ort, die Lane-Differenz und verlorene Objectives.
- Läuft der Client, holt JARVIS die Details der letzten 20 Ranked-Spiele automatisch nach.
- Orte und Anwesenheit bei Objectives stammen aus Positionen pro Minute und sind daher Schätzungen.

## 3.12.2 – LoL-Analyse auch ohne laufenden Client

- „Analysiere meine letzten LoL-Games“ funktioniert jetzt auch, wenn der League-Client zu ist. JARVIS analysiert die gespeicherten Matches und nennt den Stand der letzten Synchronisierung. Neue Spiele kommen automatisch dazu, sobald der Client das nächste Mal läuft.

## 3.12.1 – Klare Meldung bei leerem Gemini-Guthaben

- **„Kein Guthaben (402)“:** Ist die Abrechnung aktiv, das Vorauszahlungsguthaben aber 0 €, sagt JARVIS das jetzt direkt und erklärt, was zu tun ist. Vorher kam fälschlich „Limit pro Minute“, und JARVIS hat unnötig Ausweichmodelle durchprobiert.
- Die multimodalen „Omni“-Modelle mit sehr kleinen Limits werden nicht mehr als Ausweichmodell für den Chat benutzt.

## 3.12.0 – Gemini-Limits verständlich und ohne Abbruch

- **Klare Meldung, welches Limit gegriffen hat**, z. B. „Anfragen pro Minute (Limit 10) bei gemini-3.8-flash – kostenloser Tarif“, statt nur „429“.
- **Modelle, die dein Tarif nicht erlaubt (limit: 0), überspringt JARVIS ab sofort automatisch**, z. B. Pro-Modelle im kostenlosen Tarif. „Reasoning“-Fragen gehen dann an das schnelle Modell.
- **Minutenlimit:** Statt abzubrechen wartet JARVIS kurz (bis ca. 1 Minute) und versucht es selbst erneut. Im Chat steht solange „Gemini-Minutenlimit erreicht – JARVIS wartet kurz …“.
- Ist ein Tageskontingent aufgebraucht, wird das Modell für ein paar Stunden übersprungen. Es geht dann direkt mit einem anderen Gemini-Modell weiter. Ein leeres Suchkontingent sperrt dabei nicht das ganze Modell.

## 3.11.0 – Gemini-Ausfälle abfangen, LoL-Spiele ohne Matchhistorie

- **„Modell überlastet“ (503):** Ist Gemini überlastet, versucht JARVIS es automatisch erneut und weicht danach auf ein anderes Gemini-Modell aus (z. B. Flash-Lite oder Pro). Es bleibt alles in der Cloud, es gibt keine lokalen Modelle.
- Klappt es trotzdem nicht, steht statt des JSON-Kauderwelschs eine verständliche Meldung im Chat, mit dem Knopf **„Nochmal versuchen“**. Die Antwort kommt dann in dieselbe Blase, ohne dass die Frage doppelt im Verlauf steht.
- Fehlermeldungen werden nicht mehr als „Antworten“ ans Modell zurückgeschickt.
- **League of Legends aktualisiert sich von selbst:** Nach jedem Spiel holt JARVIS das gerade beendete Spiel direkt über die Spiel-ID aus dem Client, auch wenn Riot ein paar Minuten braucht. Die Matchliste wird zusätzlich direkt vom Server geladen statt aus dem Zwischenspeicher des Clients. Beim Start des Clients gleicht JARVIS sofort ab. Du musst die Matchhistorie nicht mehr öffnen.

## 3.10.0 – Eigene Game-Seiten für deine Steam-Spiele

- **Alle Spiele aus deiner Steam-Bibliothek mit mindestens einer Minute Spielzeit haben jetzt eine eigene, passende Seite**, dazu Hytale. Das sind über 40 Spiele, von ARK, Rust, CS2, EA FC und The Isle über Palworld, Elden Ring, Apex, Raft, Stardew Valley und Timberborn bis zu MX Bikes, The Crew 2 und NFS Heat.
- **„Frag JARVIS“:** Pro Spiel gibt es typische Fragen zum Anklicken, z. B. „Was mache ich direkt nach dem Wipe zuerst?“ (Rust), „Wie funktioniert Zucht und Imprinting?“ (ARK) oder „Welche SBCs lohnen sich gerade?“ (FC). Fragen mit „…“ landen im Eingabefeld, damit du sie ergänzen kannst.
- **Oberfläche je Spielart:** Survival bekommt Timer, Basis und Bosse, Shooter Rang, Loadouts und Aufwärmen, Racing Fahrzeuge, Strecken und Setups, FC Ultimate Team und Rivals, Aufbau-Spiele Karten und Forschung. Passend dazu gibt es eigene Kategorien für „Mein Spielstand“.
- **Checklisten-Vorlagen:** ARK-Bosse und Artefakte, Elden-Ring-Hauptbosse, Palworld-Turmbosse, Raft-Story-Inseln, Stardew-Gemeinschaftszentrum, JWE-Inseln, NFS-Heat-Sammelobjekte, Rust „Nach dem Wipe“, CS2 „Aufwärmen“ u. a. Alles abhakbar und änderbar.
- **Geprüfte Tools & Links:** Dododex, RustMaps, paldb, Apex Legends Status (aktuelle Map), Leetify, FUTBIN, Elden-Ring-Karte, Content Manager, GamesLantern und für jedes Spiel die Steam-Patchnotes. Bei Rust zeigt JARVIS den nächsten Force-Wipe mit Countdown.
- **Wikis** für die Recherche: wiki.gg, Fandom, das deutsche Stardew-Wiki und das Bohemia-Wiki für Arma 3.
- Die Seite zeigt deine **Steam-Spielzeit** und wann du zuletzt gespielt hast. EA FC 25 und FC 26 laufen auf einer Seite zusammen. Soundpad, Wallpaper Engine und Crosshair V2 gelten nicht als Spiele.
- Game-Seiten aus 3.8.0, auf denen du noch nichts gespeichert hast, werden mit den neuen Seiten zusammengeführt.

## 3.9.0 – Brain aufgeräumt, Geburtstage in den Kalender

- **Brain-Layout repariert:** Die Karten rechts (Übersicht, Kategorien, Projekte, Pflege) überlappen sich nicht mehr, die Spalte scrollt stattdessen. Der Wissensgraph passt sich der Fenstergröße an: Beschriftungen stehen unter den Knoten, die Anzahl als kleines Abzeichen, und Einträge werden nur so lang angezeigt, wie Platz ist. Mit der Maus siehst du den vollen Titel. Kategorien ohne Einträge sind gedimmt, und unter „Kategorien“ stehen jetzt auch Technologie und Gaming.
- **Geburtstage aus dem Brain landen automatisch im Kalender:** „Max hat am 12. März Geburtstag“, „Geburtstag von Lisa: 04.05.1999“, „Paul (geb. 14.07.1998)“, „Mama hat am 24.12. Geburtstag und Papa am 1.1.“ usw. werden zu ganztägigen, jährlichen Terminen „Geburtstag: Name“, mit Google synchronisiert.
  - Änderst du das Datum im Brain, wandert der Termin mit. Löschst du den Eintrag, verschwindet auch der Termin.
  - Löschst du den Termin selbst, legt JARVIS ihn nicht wieder an. Gibt es den Geburtstag schon im Kalender (z. B. aus Google), entsteht keine Dublette.
  - Abschaltbar unter Einstellungen → Gemini / KI → „Geburtstage aus dem Brain in den Kalender“.

## 3.8.0 – Steam-Bibliothek, Drive-Backup, Neustart nach Update

- **Neustart nach dem Update:** JARVIS startet nach der Installation automatisch wieder und zeigt kurz „JARVIS aktualisiert“.
- **Dashboard-Todos nach Priorität:** Rechts im Dashboard stehen zuerst die wichtigen Aufgaben (🔴 hoch, 🟡 mittel, ⚪ niedrig). Gezeigt werden alles, was heute fällig ist, tägliche Aufgaben und wichtige Aufgaben ohne Datum.
- **Steam-Bibliothek:** JARVIS liest deine Steam-Spiele direkt von deinem PC, mit Spielzeit, installiert ja/nein und Update-Status. Das klappt auch bei privatem Profil. Für jedes Spiel ab 1 Minute Spielzeit legt JARVIS automatisch eine Game-Seite an (stündlich oder per „Game-Seiten anlegen“ unter Gaming). Läuft ein Steam-Spiel, wird es erkannt.
- **Steam-Updates:** JARVIS meldet Spiele, die ein Update brauchen. „Steam-Downloads“ öffnet die Download-Warteschlange von Steam. Steam selbst lädt die Updates, weil Steam dafür keinen direkten Befehl anbietet.
- **Hytale** hat eine eigene Game-Seite.
- **Automatisches Backup in Google Drive:** Unter Einstellungen → Daten → „Drive-Backup aktivieren“. Danach sichert JARVIS einmal täglich nach „coding/“ in deinem Drive und behält die neuesten 14 Sicherungen. Gelöscht werden nur JARVIS’ eigene Sicherungsdateien. Deine Schlüssel bleiben darin mit Windows verschlüsselt.

## 3.7.0 – Spieldaten im Brain

- **Spieldaten landen jetzt dauerhaft im Brain** (Bereich Gaming): Pro Spiel gibt es einen Eintrag „Spielstand: …“, der sich bei jeder Änderung selbst aktualisiert (mit Verlauf). Für League kommen „Statistik & Rang“ (Winrate, KDA, CS, Champions, Rollen, Ziele) und eine Nachbesprechung je Spiel dazu. JARVIS kennt das alles auch, wenn das Spiel oder der Client gerade nicht läuft.
- **Nichts ist mehr „leer“, nur weil League gerade zu ist:** „Live-Match“ zeigt deinen letzten Live-Stand und das letzte gespeicherte Spiel, die Championauswahl deine letzte Auswahl mit den Tipps.
- **„Mein Spielstand“ passt jetzt zum Spiel:** RoK hat Kommandanten, Gebäude, Forschung und Ressourcen, Tarkov Quests, Versteck, PMC und Items, ARK Zähmungen, Basis, Items und Bosse. Andere Spiele bekommen allgemeine Kategorien, und die Beispiele im Eingabefeld passen zum Spiel. Bei League fällt der Kasten weg, dort kommt alles automatisch aus dem Client.

## 3.6.0 – Stundenplan-Abo (Campus Dual)

- **Kalender-Abos:** Unter Kalender → „Abos & Stundenplan“ einen ICS-Link einfügen (z. B. deinen Campus-Dual-Stundenplan) → „Abonnieren“.
- Das Abo wird **alle 15 Minuten** aktualisiert. Termine, die in der Quelle verschwunden sind, verschwinden auch in JARVIS. Ist die Quelle mal nicht erreichbar, bleiben die letzten Termine stehen.
- Abo-Termine sind schreibgeschützt und haben eine eigene Farbe. Wiederholungen, Ausfälle (EXDATE) und verschobene Einzeltermine werden korrekt übernommen, mit Sommer- und Winterzeit.
- Die Termine kennt auch JARVIS im Chat („Was hab ich morgen in der Uni?“).

## 3.5.0 – Ganztägige Termine & Farben

- **Ganztägige Termine** über den Schalter „Ganztägig“ im Termin-Dialog, auch mehrtägig (z. B. Urlaub „bis einschließlich“). Ein Doppelklick auf einen Tag in der Monatsansicht legt direkt einen ganztägigen Termin an.
- **Geburtstage erkennt JARVIS automatisch:** Steht „Geburtstag“ im Titel, schlägt der Dialog „ganztägig“ und „jährlich“ vor.
- **Farben:** Kategorien bekommen automatisch eigene Farben und Symbole: Geburtstage 🎂 rosa, Feiertage 🎉 grün, Prüfungen 📝 rot, Abgaben ⏰, Lernen 📚 lila, Urlaub 🌴 gelb, Arzt 🩺, Sport 🏃. Dazu kannst du pro Termin eine der 11 Google-Farben wählen. Sie wird mit Google Kalender synchronisiert, und Farben aus Google werden übernommen.
- **Wiederholen** direkt im Dialog: täglich, wöchentlich, monatlich, jährlich.
- **Neue Auswahllisten:** Alle Dropdowns sind jetzt eigene Auswahllisten statt der Windows-eigenen, die sich in JARVIS nicht zuverlässig öffnen ließen. Bedienbar auch per Tastatur.

## 3.4.0 – Studium aus Google Drive

- **Google Drive als Quelle fürs Studium:** JARVIS gleicht deinen Drive-Ordner **„Goodnotes“** ab, nur lesend. Unterordner werden zu Fächern, Google-Docs und -Folien kommen als PDF. Neue und geänderte Dateien werden alle 20 Minuten übernommen, gelöschte verschwinden aus dem Index.
- Einrichtung: Einstellungen → Studium → Quelle „Google Drive“ → **Google Drive verbinden**. In der Google Console muss dafür einmal die **Google Drive API** aktiviert sein.
- Gibt es mehrere Ordner mit dem Namen, kannst du den richtigen auswählen.

## 3.3.5 – Aufgeräumtes Startmenü

- Im Startmenü gibt es nur noch **einen** JARVIS-Eintrag. Deinstallieren geht über Windows → Einstellungen → Apps.
- Reste von **JARVIS 2.0** werden beim Installieren entfernt: alter Startmenü-Eintrag, alter Eintrag in der Apps-Liste, alter Deinstaller und die alte Python-Laufzeit im Programmordner. Deine Daten bleiben unberührt.

## 3.3.4 – Schnellerer Update-Download

- Der Download wird zuerst unter neutralem Namen in großen Blöcken geschrieben und erst am Ende zur .exe umbenannt. Virenscanner prüfen die wachsende Datei so nicht mehr bei jedem Schreibvorgang neu.
- Der Update-Dialog zeigt MB, Geschwindigkeit und Restzeit. Bei sehr langsamer Verbindung gibt's einen Link zum Download im Browser.

## 3.3.3 – Google-Anmeldung ehrlicher

- Im Browser steht „verbunden“ erst, wenn die Verbindung **wirklich** geklappt hat. Vorher meldete die Seite schon Erfolg, bevor JARVIS die Anmeldung abgeschlossen hatte.
- Schlägt die Anmeldung fehl, zeigen Browser **und** JARVIS den genauen Grund auf Deutsch (z. B. Client-Secret falsch oder fehlt, falscher Client-Typ, nicht als Testnutzer eingetragen). JARVIS holt sich danach wieder in den Vordergrund.

## 3.3.2 – Installer-Umlaute

- Der Installer zeigt Umlaute jetzt korrekt („persönlichen“ statt „persÃ¶nlichen“).
- Erstes Update über den neuen „Aktualisieren“-Button. Wenn du das liest, hat er funktioniert. 🎉

## 3.3.1 – Update-Download repariert

- **Updates aus privaten Repos** funktionieren jetzt. In 3.3.0 brach die Prüfung mit „Redirect was cancelled“ ab, weil Electron Weiterleitungen beim GitHub-Download nicht korrekt durchgereicht hat.
- Dasselbe betraf das Speichern von Webseiten und Kalender-Abos mit Weiterleitung. Auch das ist behoben.
- Der Selbsttest der App prüft das jetzt mit.

## 3.3.0 – Update-Button, In-Game-Overlay, TarkovTracker, LoL-Coach

- **Ein-Klick-Updates:** Neue Versionen kommen aus GitHub Releases. Oben erscheint „Aktualisieren“, und JARVIS prüft die Signatur, legt eine Sicherung an, installiert still und startet neu.
- **In-Game-Overlay:** Ein schlankes HUD über dem Spiel (randloses Fenster) mit Timern, Spielstand, Mini-Karte, Sprachstatus und Antworten. Strg+Alt+O schaltet es ein und aus, Strg+Alt+I macht es kurz bedienbar.
- **„Was ist das?“ (Strg+Alt+W):** JARVIS sieht sich auf Knopfdruck deinen Bildschirm an und beantwortet die Frage im Overlay, z. B. RoK-Timer, Items oder Fehlermeldungen. Screenshots bleiben lokal.
- **TarkovTracker-Sync:** Erledigte Quests und dein PMC-Level landen automatisch in „Mein Spielstand“. Mit Schreibrecht wird dein Abhaken in JARVIS zurückübertragen.
- **League of Legends:** Matchup-Tipps in der Championauswahl (nur Champions, keine Spielerdaten) und eine automatische Nachbesprechung nach jedem Spiel mit deinen Werten im Vergleich zum Schnitt und zu deinen Trainingszielen.
- Trainingsziele wie „7 CS/min“ oder „max. 5 Tode“ werden jetzt messbar ausgewertet.
- Spiele werden beim Start zuverlässiger erkannt.
- **Gemini-Limits:** Bei „Kontingent erschöpft“ (429) weicht JARVIS automatisch auf ein anderes Flash-Modell aus. Die Recherche antwortet notfalls ohne Live-Suche (mit Hinweis). Die Fehlermeldung unterscheidet jetzt zwischen Minuten- und Tageslimit.
- **Minecraft-Wiki** jetzt auf Deutsch, mit englischem Wiki und Volltextsuche als Ausweichlösung.
- **Google-Kalender:** klare Hinweise, wenn die Client-JSON kein Secret enthält oder der Client-Typ falsch ist. Aktuelle Anleitung für die Google Auth Platform.
- Update-Einstellungen unterscheiden jetzt „noch kein Release“ von „kein Zugriff“.

In Arbeit (kommt per Update): Klausurmodus mit Lernplan-Rückwärtsplanung, DHSN-Stundenplan (ICS) mit Notiz-Verknüpfung, Telegram-Bot, PC-Steuerung per Sprache, Offline-Modus (Ollama), GitHub-Projekte.

## 3.2.0 – League ohne API-Schlüssel

- Matchhistorie und Rang direkt aus dem laufenden League-Client.

## 3.1.0 – Mein Spielstand

- JARVIS merkt sich deinen Fortschritt pro Spiel als Kontext.

## 3.0.0 – Neubau

- Komplette Neuentwicklung als Electron-Desktop-App.
