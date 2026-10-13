# Changelog

Jeder Abschnitt `## x.y.z` erscheint als Changelog im Update-Dialog von JARVIS.

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
