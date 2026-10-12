# Google Kalender verbinden (einmalig, ca. 5 Minuten)

JARVIS nutzt das offizielle OAuth-Verfahren für Desktop-Apps. Weil JARVIS kein verifiziertes Google-Produkt ist, legst du dir einen eigenen OAuth-Client an – deine Daten fließen dann nur zwischen deinem PC und Google.

1. <https://console.cloud.google.com> öffnen → oben **Projekt auswählen → Neues Projekt** (z. B. „JARVIS“).
2. **APIs & Dienste → Bibliothek** → „Google Calendar API“ → **Aktivieren**.
3. **APIs & Dienste → OAuth-Zustimmungsbildschirm** → Nutzertyp **Extern** → App-Name „JARVIS“, deine E-Mail → speichern. Unter **Testnutzer** deine eigene Google-Adresse hinzufügen.
4. **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen → OAuth-Client-ID** → Anwendungstyp **Desktop-App** → Erstellen → **JSON herunterladen**.
5. In JARVIS: **Einstellungen → Kalender & Google → JSON-Datei laden** (oder im Einrichtungsassistenten, Schritt 4) → **Im Browser anmelden**.
6. Im Browser das Konto wählen und den Kalenderzugriff erlauben (Hinweis „Google hat diese App nicht überprüft“ → *Erweitert → Weiter zu JARVIS*, da es dein eigener Client ist).

Danach synchronisiert JARVIS alle 15 Minuten (einstellbar). Neue Termine aus Chat/Sprache landen nach deiner Bestätigung sofort in Google und erscheinen auf dem Smartphone.

**Rechte:** `calendar` (Lesen/Schreiben) und `openid email` (Kontoanzeige). Das Refresh-Token wird mit Windows-DPAPI verschlüsselt gespeichert. **Trennen** in den Einstellungen widerruft das Token.

**Hinweis Testmodus:** Solange der Zustimmungsbildschirm im Status „Test“ ist, laufen Refresh-Tokens nach 7 Tagen ab. Für dauerhafte Nutzung den Status auf „In Produktion“ setzen (für den Eigengebrauch ohne Verifizierung möglich; Google zeigt dann weiterhin den Hinweis aus Schritt 6).
