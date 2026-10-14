# Changelog

Jeder Abschnitt `## x.y.z` erscheint als Changelog im Update-Dialog von JARVIS.

## 3.21.0 – Tarkov-Eck-Karte, Exits nach PMC/Scav, Schlüssel im Backup

- **Tarkov-Karte oben links:** Solange Tarkov läuft, zeigt ein kleines Overlay-Fenster oben links die aktuelle Raid-Karte. Darauf sind die Exits, Transits, deine Marker und deine Position aus dem letzten Screenshot. Nach einem Screenshot zoomt die Karte 5 Minuten lang auf dich. Größe, Zoom und Ein/Aus stellst du unter Einstellungen → Overlay ein. Steht das große Overlay auch links, rutscht es darunter.
- **Exits für PMC oder Scav:** Auf der Karte und im Overlay wählst du PMC, Scav oder Alle. Gemeinsame Exits erscheinen immer. Die Farben zeigen die Art: grün = normal, orange = Flare, lila = Co-op, blau = Fahrzeug (V-Ex), türkis = Transit. Die Art erkennt JARVIS aus dem Exit-Namen, weil tarkov.dev sie nicht eigens angibt.
- **Positions-Screenshots in eigenem Ordner:** Nach dem Lesen wandern sie nach „Screenshots\JARVIS Positionen“ und werden nach 7 Tagen gelöscht. Beides lässt sich einstellen, deine anderen Screenshots bleiben unberührt. Am Positionspfeil steht jetzt, wie alt die Position ist, nach ein paar Minuten wird er blasser.
- **API-Schlüssel im Backup:** Mit einem eigenen Backup-Passwort landen alle Schlüssel (Gemini, Riot, Google, TarkovTracker, Campus Dual …) verschlüsselt in jeder Sicherung, lokal und in Drive. So lassen sie sich auf jedem PC wiederherstellen; beim Wiederherstellen fragt JARVIS nach dem Passwort. Ohne das Passwort sind sie nicht lesbar. Zusätzlich gibt es „Schlüssel exportieren/importieren“ als Datei.
- **Einstellungen exportieren/importieren:** Alle Einstellungen (ohne Schlüssel) als JSON-Datei sichern und wieder einspielen. Beim Import wird jedes Feld geprüft.

## 3.20.0 – Tarkov: eigene Position auf der Karte, Raid-Planer

- **Deine Position auf der Karte:** Drück im Raid die Screenshot-Taste (Standard: Druck). Tarkov schreibt die Position und Blickrichtung in den Dateinamen des Screenshots, und JARVIS zeigt dich als gelben Pfeil auf der Karte und auf der Mini-Karte im Overlay. Das ist dasselbe Prinzip wie bei TarkovMonitor und tarkov.dev, es wird nur der Dateiname gelesen. Die Karte springt automatisch zur Raid-Karte, die JARVIS aus dem Spiel-Log erkennt. Mit „Position“ in der Kartenleiste schaltest du das Mitspringen aus.
- **Raid-Planer:** Ein neuer Baustein auf der Tarkov-Seite zeigt, welche Karte die meisten offenen Quests für dich hat. Erledigte Quests, Quests über deinem Level und noch gesperrte (Vorgänger offen) werden ausgeblendet. Für eine gewählte Karte zeigt er die Ziele je Quest, was du mitnehmen musst (Items zum Ablegen, MS2000-Marker) und welche Schlüssel du brauchst. Im Chat geht das auch: „Plan meinen nächsten Raid“ oder „Was kann ich auf Woods erledigen?“.

## 3.19.0 – TarkovTracker aktualisiert sich beim Spielen

- **Tarkov starten → TarkovTracker-Abgleich:** Sobald Tarkov läuft, gleicht JARVIS sofort mit TarkovTracker ab und danach alle 10 Minuten (sonst alle 30), nach dem Spiel noch einmal.
- **Quests direkt aus dem Spiel:** Während Tarkov läuft, liest JARVIS die Quest-Meldungen im Log-Ordner des Spiels mit, so wie das Community-Tool TarkovMonitor von tarkov.dev. Angenommene, erledigte und fehlgeschlagene Quests landen sofort in „Mein Spielstand“. Erledigte und fehlgeschlagene gehen automatisch an TarkovTracker, wenn dein Token Schreibrecht hat. Das ist nur Mitlesen von Dateien, ohne Zugriff aufs Spiel. Den Spielordner findet JARVIS selbst (BSG-Launcher oder Steam), sonst Einstellungen → Gaming → „Tarkov-Ordner“.

## 3.18.0 – Spielseiten für neue Spiele, Klausurmodus, Kostenbremse, LoL-Objectives, Tarkov-Stockwerke

- **Eigene Seite für unbekannte Spiele:** Spielst du ein Spiel, das JARVIS noch nicht kennt (oder sprichst darüber), recherchiert JARVIS es mit der Google-Suche und stellt eine passende Seite aus den festen Bausteinen zusammen: Fragen, Spielstand-Kategorien, Timer, Karte, Wiki, Checklisten, Links. Dabei wird kein eigener Code erzeugt. JARVIS prüft alles selbst: Ein Wiki kommt nur auf die Seite, wenn es wirklich antwortet, Links nur, wenn sie erreichbar sind, und Checklisten-Einträge nur, wenn sie wörtlich in den Quellen stehen. Auf der Gaming-Seite gibt es dafür „Seite gestalten“ bzw. „Neu gestalten“, im Chat „Bau mir eine Seite für …“.
- **Klausurmodus ist jetzt erreichbar:** Den Lernplaner gab es schon im Code, er war aber nirgends aufrufbar. Das ist jetzt behoben. Unter Studium → Klausuren legst du Klausuren an, siehst deinen Lernstand und lässt dir einen Lernplan um Stundenplan und Termine herum vorschlagen. Erst nach deiner Bestätigung wird er eingetragen. Im Chat geht das auch („Plane Mathe II“, „Ich hab heute 2 h gelernt“).
- **Prüfungen aus Campus Dual automatisch:** Termine mit „Klausur“ oder „Prüfung“ im Titel aus deinem Stundenplan (und, falls lesbar, aus der Prüfungsanmeldung) landen als Klausur im Klausurmodus. Verschiebt Campus Dual einen Termin, zieht die Klausur mit. Was du löschst, legt JARVIS nicht neu an.
- **Kostenbremse:** Einstellungen → Gemini / KI zeigt die geschätzten Kosten des Monats und eine Hochrechnung. Du kannst den echten Stand aus AI Studio eintragen, um die Schätzung zu eichen. Ab 80 % kommt eine Warnung. Ab 95 % laufen Analysen über das schnelle Modell, und Hintergrund-KI (LoL-Tipps, Seitenanalyse) pausiert. Chat und Sprache laufen weiter.
- **LoL Objective-Timer im Overlay:** Drache/Elder, Baron, Herold, Voidgrubs und Atakhan. Respawns werden aus den echten Kills im Match berechnet, inklusive Seele → Elder und Baron-Buff. Die ersten Spawnzeiten sind Standardwerte („≈“), die du in den Einstellungen anpassen kannst, falls ein Patch sie ändert.
- **Tarkov-Karte:** Stockwerke und Untergeschosse lassen sich umschalten. Die Ziele deiner offenen Quests erscheinen als Marker, ohne erledigte Quests und bis zu deinem Level. Klick auf einen Marker zeigt das Questziel. Bereits geladene Karten werden einmal automatisch erneuert.
- **Sicherheit & Pflege:** Das Drive-Backup enthält keine Schlüssel, Passwörter oder Anmeldungen mehr. Sie bleiben verschlüsselt nur auf dem PC. Beim Wiederherstellen einer Sicherung von einem anderen PC bleiben deine aktuellen Schlüssel erhalten. Das Log wird auch im Dauerbetrieb gekürzt, alte Tagesmarker werden aufgeräumt. Dokument-Links öffnen nur noch https-Adressen.

## 3.17.0 – Gemini deutlich sparsamer, gleiche Antworten

- **Googles Prompt-Cache greift jetzt:** Bisher stand die aktuelle Uhrzeit ganz oben in JARVIS' Anweisung. Dadurch war jede Anfrage für Google „neu“, und rund 5.500 Token Anweisung und Werkzeuge wurden jedes Mal voll berechnet. Jetzt bleibt dieser Teil gleich, und Uhrzeit, Spiel und Gedächtnis hängen an deiner neuesten Nachricht. Googles Cache liest den gleichbleibenden Teil (auch den bisherigen Verlauf und Werkzeugschritte) deutlich günstiger.
- **Weniger unnötiges „Nachdenken“:** Bei normalen Fragen denkt das Modell kurz statt maximal. Denk-Token kosten so viel wie Antwort-Token, also ein Vielfaches der Eingabe. Analysen, Lernpläne, Vergleiche und lange Texte gehen weiter mit voller Denktiefe ans Reasoning-Modell. Hintergrundaufgaben (Bildschirmfragen, Seiten lesen, LoL-Tipps) denken ebenfalls kurz. Einstellungen → Gemini / KI → „Denktiefe bei normalen Fragen“ → „Immer maximal“ stellt das alte Verhalten wieder her.
- **Sprachmodus:** Google berechnet bei jeder gesprochenen Antwort den gesamten Sitzungsverlauf neu. Der Verlauf wird jetzt ab etwa 24.000 Token auf die letzten etwa 12.000 gekürzt, statt bis weit über 100.000 zu wachsen. Der vollständige Verlauf bleibt im Chat.
- **Verbrauch pro Funktion:** Einstellungen → Gemini / KI → „Verbrauch letzte 7 Tage“ zeigt Anfragen, Eingabe (mit Cache-Anteil) sowie Ausgabe- und Denk-Token für Chat, Sprache, Webrecherche, Bildschirm, Seiten lesen und LoL. So sieht man, wo das Geld hingeht.

## 3.16.0 – Campus-Dual-Stundenplan direkt, Zugangsdaten, Prüfungsergebnisse, Tarkov-Karten

- **Campus Dual: Stundenplan kommt jetzt direkt aus dem Stundenplan-Dienst** (derselbe, den die Campus-Dual-Seite selbst nutzt) statt aus dem ICS-Export, der leer war. Erkennt JARVIS das Format nicht, zeigt das Abo die Feldnamen an, statt still 0 Termine zu melden. Das Format ist nicht offiziell beschrieben, deshalb erkennt JARVIS die Felder automatisch. Mit dem echten Campus Dual ist das noch nicht getestet.
- **Campus-Dual-Zugangsdaten in den Einstellungen (optional):** Benutzername und Passwort werden nur verschlüsselt (Windows-DPAPI) gespeichert und nie angezeigt. Läuft die Sitzung ab, meldet sich JARVIS unsichtbar selbst neu an. Eingetragen wird nur auf campus-dual.de, und es gibt höchstens einen Versuch. Werden die Daten abgelehnt, kommt ein Hinweis, damit dein Konto nicht gesperrt wird.
- **Neue Prüfungsergebnisse:** JARVIS schaut alle 3 Stunden in Campus Dual nach, ob es neue Ergebnisse gibt, und meldet sie mit Modul und Note. Findet JARVIS keine Ergebnisliste, meldet es Änderungen an der Kachel „Ergebnisse“. Im Chat geht das auch: „Hab ich neue Noten?“. Einstellungen → Campus Dual → „Jetzt prüfen“.
- **Tarkov-Karten automatisch:** Die Gaming-Karte lädt die Vektorkarten von tarkov.dev (Zollgebiet, Woods, Shoreline, Interchange, Reserve, Lighthouse, Streets, Ground Zero, Factory, Terminal) und kalibriert sie selbst. Exits und verschlossene Türen erscheinen sofort an der richtigen Stelle. Labs, Labyrinth und Icebreaker gibt es dort nur als Kachelbilder, für sie bleibt der Weg über ein eigenes Bild. Quelle: Shebuka / tarkov.dev (CC BY-NC-SA 4.0). Eigene Kartenbilder werden nie überschrieben.

## 3.15.1 – Campus-Dual-Anmeldung & Kalender-Layout repariert

- **Campus-Dual-Anmeldefenster zeigte „404 Not found“:** JARVIS probiert jetzt nacheinander die üblichen Adressen des Campus-Dual-Launchpads. Findet es keine, kommt eine klare Anleitung. Unter Kalender → Abos → „Campus-Dual-Adresse“ kannst du die Adresse aus deinem Browser eintragen, dann nimmt JARVIS genau die.
- Ein Campus-Dual-Link ohne Anmeldung zeigt jetzt „Bei Campus Dual anmelden“ mit Knopf statt „Keine gültige iCalendar-Datei“.
- **Kalender-Layout:** Die Karten rechts (Google Kalender, Kalender, Abos) überlappen sich bei kleineren Fenstern nicht mehr, die Spalte scrollt. Die Monatsleiste bricht sauber um, und der Campus-Dual-Bereich passt in die schmale Spalte.

## 3.15.0 – Campus Dual mit Anmeldung, Sprach-Standby

- **Campus Dual (neues Portal) mit Anmeldung:** Kalender → Abos → **„Bei Campus Dual anmelden“** öffnet ein Fenster, in dem du dich ganz normal anmeldest. JARVIS sieht und speichert dein Passwort nicht. Danach findet JARVIS deinen Stundenplan-Link selbst (oder du fügst deinen ICS-Link ein) und lädt ihn alle 15 Minuten mit deiner Anmeldung. Die Anmeldung bleibt auch nach einem Neustart erhalten (verschlüsselt gespeichert).
- Läuft die Anmeldung bei Campus Dual ab, bleibt der letzte Stundenplan sichtbar. JARVIS meldet das mit dem Knopf „Bei Campus Dual anmelden“.
- Ein eingefügter fep.campus-dual.de-Link wird automatisch zum Abo mit Anmeldung. Für das alte Selfservice-Portal gibt es weiter den Weg über Matrikelnummer und Hash.
- **Sprach-Standby:** Sag „Geh in den Standby“, „Jarvis, Pause“ oder „Schlaf jetzt“. JARVIS bestätigt kurz, pausiert dann die Sprachaufnahme und hört nur noch auf **„Hey Jarvis“**. Danach geht das Gespräch weiter, wo es war. Ist das Wake-Word noch aus, schaltet JARVIS es dafür ein. Der Befehl wird direkt im Transkript erkannt und klappt deshalb auch, wenn das Modell gerade hängt. „Mach eine Pause von 5 Minuten im Kalender“ löst ihn nicht aus.

## 3.14.0 – Systemcheck, Campus Dual direkt, Drive-Backup repariert

- **Drive-Backup repariert:** „Jetzt in Drive sichern“ brach mit `net::ERR_INVALID_ARGUMENT` ab, weil JARVIS beim Hochladen eine Angabe selbst gesetzt hat, die Chromium nicht erlaubt. Behoben. Der Release-Test prüft das Hochladen jetzt bei jedem Build.
- **Campus Dual direkt verbinden:** Der Exportlink (fep.campus-dual.de/ics/…) liefert ohne Anmeldung einen leeren Kalender. Deshalb ging bisher nur das Hochladen der .ics-Datei. Neu: Kalender → Abos → **„Campus Dual verbinden“** mit Matrikelnummer und Hash. Der Hash steht im Seitenquelltext deines Stundenplans, die Anleitung ist direkt dabei. JARVIS holt die Termine dann alle 15 Minuten direkt aus Campus Dual, inklusive Raum, Dozent und Hinweisen, ganz ohne Passwort. Der Hash wird verschlüsselt gespeichert.
- Fügt jemand den leeren Exportlink ein, erklärt JARVIS das sofort, statt still 0 Termine anzuzeigen.
- **Systemcheck** (Einstellungen → „Systemcheck“): Er prüft mit echten Testanfragen Gemini, Google-Konto, Google Kalender, Google Drive, Drive-Backup, Studienordner, Kalender-Abos, League, Steam, Updates, lokale Sicherungen und Speicherplatz. Jedes Problem steht mit einer verständlichen Erklärung und einem **Lösungs-Knopf** da, z. B. „Google Drive API aktivieren“, „AI Studio öffnen“ oder „Google neu verbinden“. Einmal täglich läuft er auch im Hintergrund und meldet nur echte Probleme.
- **Verständliche Google-Fehler mit Lösung:**
  - Ist eine Google-API im Projekt nicht aktiviert, steht genau das da, mit Knopf direkt zur Aktivierungsseite.
  - Fehlende Berechtigungen führen zu „Google neu verbinden“.
  - Läuft die Anmeldung alle 7 Tage ab, erklärt JARVIS den Testmodus der Google-App und wie man ihn beendet.
- Fehlermeldungen in Einstellungen, Kalender-Abos, Drive-Backup, Benachrichtigungen und Chat zeigen Links jetzt als Knöpfe.

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
