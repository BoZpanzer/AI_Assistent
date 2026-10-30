# Second Brain für einen unregelmäßig genutzten Alltagsassistenten

## Ziel und Produktentscheidung

JARVIS soll aus normalen Aussagen lernen und durch kurze Gespräche eine belastbare Grundlage aufbauen. Der Nutzer muss weder alle Lebensbereiche kennen noch jede Ausgabe protokollieren. Ausgangspunkt ist ein junger dualer Student; Beispiele sind Hilfestellung, keine automatisch eingetragenen Fakten. Bestehende Desktop-Oberfläche, Alltag, Studium, Kalender und Brain bleiben zusammenhängend.

Das System verwaltet belegte Teilkenntnis. Schweigen bedeutet weder „unverändert“ noch „erledigt“. Ein Monat ohne Nutzung muss ohne Schuldgefühl oder Nachtragen jeder Transaktion überbrückbar sein. Keine Kontenanbindung ist Voraussetzung.

## Lieferstand dieses Branches

- Lokales Startgespräch in sieben Bereichen, aus Dashboard und Alltag erreichbar; auch per „Starte mein Startbriefing“.
- Eine Frage nach der anderen, Antworten in normaler Sprache als Originalnotizen. Kein Modell oder API-Schlüssel notwendig.
- Pausieren, Fortsetzen nach Neustart, Zurückgehen, unbekannte/übersprungene/nicht zutreffende Bereiche.
- Abschließende Prüfung mit „übernehmen“. Vorher sind die Notizen Entwürfe.
- Quellenverknüpfung auf Nachrichten statt duplizierter Finanztexte. Löschen einer Ursprungsnachricht entfernt abhängige Briefing-Einträge.
- Alltag zeigt Besprechungsstand, Originalnotizen, Quellen und nach Bereichen veraltete Angaben. Dashboard-Angebot ist um sieben Tage verschiebbar.
- Folgecheck fragt offene/veraltete Bereiche ab. „Unverändert“ setzt einen vorhandenen geprüften Stand voraus und behält dessen Originalquelle.
- Der vorhandene Finanzrest ist als Rechnung aus erfassten Angaben beschriftet; nicht als sicher verfügbares Geld.

Noch nicht umgesetzt: natürliche Aufteilung freier Antworten in mehrere strukturierte Objekte, Vertragsverwaltung, automatische Zahlenübernahme, persistente Learner-Warteschlange, gemeinsame/semantische Suche, aktive Erinnerungen aus diesem Briefing und adaptive Folgefragen. Die Bestandsaufnahme wird noch nicht automatisch zum Modellkontext hinzugefügt. Spracheingabe über die vorhandene Transkription ist möglich; Briefing-Antworten erscheinen in dieser Stufe nur als Text, damit sie nicht über eine konfigurierte Cloud-Stimme ausgegeben werden. Es gibt keinen Anspruch auf vollständige finanzielle Erfassung.

## Gesprächsablauf im Zielzustand

1. Einladung: „Lass uns eine erste Übersicht bauen. Was du nicht weißt, lassen wir offen.“ Kurzer Start, jederzeit später weiter.
2. Lebenssituation: Wohnen, selbst organisierte Verpflichtungen, grobe Studien-/Praxisphase. Keine genaue Adresse oder Arbeitgeberdaten verlangen.
3. Einnahmen: regelmäßige Zahlungen, Netto/Brutto, Zeitraum, sicher/ungefähr. Unbekannt bleibt null, niemals 0.
4. Kosten: Wohnen, Mobilität, Essen, Handy und unregelmäßige größere Zahlungen. Wer zahlt tatsächlich? Geteilte oder von Familie bezahlte Verträge nicht als eigene volle Kosten buchen.
5. Verträge: Anbieter und Zweck zuerst; Preis, Rhythmus, Laufzeit und Dokument danach. „Keine Ahnung“ erzeugt eine offene Frage, keine Pflicht zum sofortigen Suchen.
6. Studium und Papierkram: anstehende Phasenwechsel, Prüfungen, Nachweise, Briefe und offene Fristen. Bestehende Termine/Abgaben wiederverwenden statt duplizieren.
7. Abschluss: wenige vorgeschlagene Einträge, offene Fragen und höchstens drei nächste Schritte. Geldbeträge, Fristen und neue Aktionen vor Übernahme zusammen anzeigen.

Ein Startgespräch muss nicht vollständig sein. Eine kurze Version kann zuerst Verträge und wichtigste Fristen behandeln; weitere Bereiche folgen später. Die aktuelle erste Implementierung hat feste Fragen. Adaptive Auswahl kommt nach stabiler Extraktion.

## Was normale Sätze bedeuten

| Aussage | Interpretation | Nicht daraus ableiten |
|---|---|---|
| „Ich bekomme so um die 1100.“ | Betrag ungefähr; Währung, Netto/Brutto und Zeitraum offen | Sicheres monatliches Nettogehalt |
| „Mein Handy zahlt noch meine Mutter.“ | Beziehung Vertrag/Zahler; eigener Anteil offen | Eigene monatliche Kosten in voller Höhe |
| „Spotify kostet mich 6 Euro im Monat.“ | Kandidat für regelmäßige Ausgabe mit Quelle | Bereits bezahlte Kontotransaktion |
| „Ich glaube, das läuft im März aus.“ | Ungeprüfte Laufzeitaussage | Rechtssichere Kündigungsfrist |
| „Vielleicht ziehe ich nächstes Jahr aus.“ | Überlegung mit unsicherem Zeithorizont | Aktueller Wohnort oder feste Umzugsaufgabe |
| „Die Versicherung läuft wohl über meine Eltern.“ | Ungeprüfte Zuordnung und Prüffrage | Bestehender Versicherungsschutz |
| „Hab das gekündigt.“ | Kündigungsabsicht/-handlung, Bezugsobjekt klären | Vertrag beendet, Zahlungen gestoppt |
| „Ich habe nichts eingetragen.“ | Erfassungsstand unbekannt | Keine Ausgaben |

Jede Extraktion braucht ein wörtliches Belegstück aus einer Nutzeräußerung oder freigegebenen Quelle. Assistentenantworten sind kein Beweis. Negationen, Schätzungen, fremde Personen und hypothetische Aussagen müssen erhalten bleiben. Bei unklaren Pronomen nachfragen oder einen Kandidaten offenlassen.

## Datenmodell der nächsten Ausbaustufen

### Gemeinsame Belege und Zustände

`memory_evidence`: Ursprungsnachricht/Dokumentversion/Seite, belegender Textbereich, erfasst_am, Quelle, Datenschutzklasse.

`memory_claims`: Subjekt, Eigenschaft, Wert, Aussageart (Fakt/Vorliebe/Plan/Idee/Erfahrung), Gewissheit (genau/geschätzt/unbekannt), gültig_ab/bis, Status (Entwurf/bestätigt/widersprüchlich/ersetzt), geprüft_am, Belege.

Subjekte bekommen stabile IDs und geprüfte alternative Namen. Gleich benannte Personen bleiben getrennt. Gleichartige Aussagen zu unterschiedlichen Projekten dürfen sich nicht ersetzen. Wiederholung derselben Quelle erhöht die Sicherheit nicht.

### Verträge

`contracts`: Anbieter, Zweck, Status, Vertragspartner/Zahler, eigener Anteil, Preis in Cent, Währung, Zahlungsrhythmus, Beginn, Mindestlaufzeit, Verlängerung, ausdrücklich belegte Kündigungsregel, nächster Zahlungstermin, Dokumentreferenzen, geprüft_am.

Unbekannte Felder bleiben leer. Ein Monatsäquivalent für Jahreskosten wird getrennt von der tatsächlichen Jahresfälligkeit gespeichert/angezeigt. Ein Preiswechsel braucht einen Gültigkeitsbeginn. Kündigung eingereicht, bestätigt und Vertrag beendet sind unterschiedliche Zustände. JARVIS darf keine Frist aus einer Standardannahme ableiten. Rechtliche Bewertung wäre ein gesonderter, aktuell zu belegender Schritt.

Bestehende `subscriptions` und `recurring` weiterverwenden bzw. eindeutig verknüpfen. Ein Vertrag darf nur einmal in der Kostenrechnung vorkommen. Migrationen erhalten IDs, Historie und Rückverweise.

### Geldübersicht

Drei getrennte Sichten: regelmäßiger Plan, tatsächlich erfasste Zahlungen und offene/unbekannte Posten. Keine Vermischung mit Kontostand. Betrag in ganzzahligen Cent; ungefähre Angaben mit eigener Kennzeichnung oder Bandbreite. Einkommen erst nach Klärung von Netto/Brutto und Rhythmus in die Monatsrechnung übernehmen.

Ein Nutzer soll eine grobe Übersicht ohne lückenloses Haushaltsbuch führen können. Ein optionaler Screenshot oder ein Dokument kann einen Stand aktualisieren; Datum und Quelle bleiben sichtbar. Transfers zwischen eigenen Konten sind keine Einnahmen. Jahreskosten und Rücklagen sind nicht automatisch bereits bezahlte Ausgaben.

## Priorisierte Umsetzung mit Abnahmekriterien

| Stufe | Arbeit | Fertig, wenn |
|---|---|---|
| 1 – Einstieg | Startgespräch, Unterbrechen, Quellen, offene Bereiche | Neustart/Zurück/Löschen funktionieren; unbekannt bleibt unbekannt; keine Cloud-Aufrufe im Dialog |
| 2 – Aus Sätzen lernen | Dauerhafte Jobs beim Nachrichtenspeichern, kleine Abschnitte mit Fortsetzungsmarken, validierte Extraktion, Entwürfe und Übernahmekarten | Zehn schnelle Nachrichten gehen nicht verloren; Wiederholung nach Absturz erzeugt keine Duplikate; erfundene Zitate werden abgelehnt |
| 3 – Verträge und Kosten | Strukturierte Entwürfe, fehlende Felder gezielt nachfragen, Dokumentbelege, bestehende Finanzobjekte verknüpfen | Jahresbetrag/monatlicher Betrag werden nicht verwechselt; fremd bezahlte Verträge und bestehende Abos werden nicht doppelt gezählt |
| 4 – Erinnern | Gemeinsame Suche über Brain, Originalchats, Dokumente; lokale Embeddings ergänzen Volltext; aktuelle und frühere Stände trennen | Neue Unterhaltung findet alte Entscheidungen mit Quelle; geschätzte/ersetzte Aussagen werden korrekt gekennzeichnet |
| 5 – Rückkehr | Freiwilliger kurzer Wochen-/Monatscheck, Rückkehr nach Pause, neue Fristen priorisieren | Keine erledigt-Annahme aus Schweigen; keine Flut nach vier Wochen Abwesenheit; Aufschieben/Abschalten wirkt |
| 6 – Pflege und Schutz | Quellenübergreifendes Vergessen, Backup-Regeln, Widerspruchsprüfung, lokale Sprachantworten | Gelöschtes kehrt nicht aus Index/Zusammenfassung zurück; private Belege gelangen nicht unbemerkt zur Cloud |

Stufen 2–3 bilden die nächste zusammenhängende Umsetzung: ein Satz wird zu prüfbaren Alltagsobjekten. Stufe 4 verbessert das langfristige Wiederfinden. Das vorhandene Brain bleibt dabei die Wissensbasis, wird aber nicht zum alleinigen Speicher aller Buchungen und Vertragszustände.

## Technische Einbindung

- `Conversations.add`: Lernjob in derselben Datenbanktransaktion wie die Nutzernachricht erzeugen. Job enthält Referenzen, nicht nochmals den gesamten Inhalt.
- `Learner`: pro Nachricht/Abschnitt einen idempotenten Auftrag. Retry mit Abstand, Status sichtbar, nach Neustart wieder aufnehmen. Tageslimits verschieben Arbeit, sie verwerfen sie nicht.
- Eigener Extraktor liefert nur Kandidaten. Lokale Validierung prüft Schema, exakte Belege, Herkunft, Zahlenformate, erlaubte Werte und Datenschutz.
- Finanzen/Verträge erhalten zuerst Entwürfe. Die Bestätigung gilt für die konkrete Vorschau; keine pauschale Vollmacht für weitere Buchungen oder Kündigungen.
- Abrufbudget: kleine relevante Auswahl, Quellen auf Nachfrage nachladen. Kein vollständiges Finanzprofil in jeder Gaming-Antwort.
- Dokumente und Chattexte sind Daten, keine Anweisungen. Angebliche Aufforderungen in einem Vertrag dürfen keine Werkzeuge auslösen.
- Hintergrundarbeit drosseln, wenn gespielt wird. Antwortzeiten messen; Semantik-Ausfall muss auf lokale Volltextsuche zurückfallen.

## Rückkehr und Check-ins

Beim Öffnen ein unaufdringliches Angebot, kein erzwungener Fragebogen. Während aktiver Spiele keine Unterbrechung. Beispiel nach längerer Pause:

„Dein letzter Geldüberblick ist vier Wochen alt. Sollen wir kurz prüfen, ob sich Einnahmen oder laufende Kosten geändert haben? Zwei Vertragsfristen sind noch ungeklärt.“

Das darf JARVIS nur sagen, wenn die Zeit und die offenen Fristen im Datenbestand belegt sind. Ansonsten: „Zu deinen Vertragsfristen habe ich noch keine Angaben.“ Ein Nutzer kann den Check verschieben, einzelne Bereiche überspringen oder die Häufigkeit später ändern. Notizen ohne verifizierten Stichtag lösen keine dringlichen Warnungen aus.

## Test- und Freigabeplan

Automatisierte Fallmatrix mit normalen deutschen Sätzen: Schätzung, Negation, unklarer Zeitraum, Fremdzahler, Korrektur, unbekannt, keine Nutzung, Dokumentwiderspruch, Jahreszahlung, gekündigt vs. beendet. Testdaten sind synthetisch.

Für jede Stufe: Datenmigration mit vorhandenen Einträgen; Prozessneustart; doppelte Zustellung; gelöschte Quelle; Privacy-Routing mit deaktivierter lokaler KI; Ausfall des Modells; Kontextbudget. Zusätzlich reale Windows-Abnahme von Layout, Tastatur, Sprache, Pausieren/Fortsetzen und großen Schriftgrößen. Erst nach dieser Abnahme einen Windows-Release veröffentlichen.
