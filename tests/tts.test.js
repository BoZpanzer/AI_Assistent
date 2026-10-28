'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { speakable } = require('../src/main/voice/speakable');

const LOL = `*(Hinweis: Der League-Client ist aktuell nicht aktiv verbunden.)*

Hier ist die Auswertung deiner letzten 5 Matches (**1 Sieg, 4 Niederlagen**):

### 1. Match-Übersicht
* **Sett (Niederlage, 48 Min):** 1/10/9 – 4.7 CS/min, 25% KP
* **Irelia (Niederlage, 23 Min):** 3/9/2 – 6.4 CS/min, 36% KP

---

### 2. Die wichtigsten Fehlermuster
1. **Frühe Tode & Ganks (Höchste Priorität)**
   * Du stirbst im Schnitt **2-mal vor Minute 14** (in 3 von 5 Spielen).
   * Bei Minute 10 liegst du **-15 CS** hinten, bei Minute 15 **-695 Gold**. 🎉
   * Mehr: [Guide](https://example.com/x)`;

test('Speech version: no markdown symbols, numbers and units spoken naturally, long answers shortened', () => {
  const full = speakable(LOL, { full: true }).text;
  assert.doesNotMatch(full, /[*#|`🎉]|https?:/);
  assert.match(full, /1, 10, 9/);
  assert.match(full, /4,7 CS pro Minute/);
  assert.match(full, /25 Prozent Kill-Beteiligung/);
  assert.match(full, /minus 695 Gold/);
  assert.match(full, /Frühe Tode und Ganks/);
  assert.match(full, /Mehr: Guide/);
  const short = speakable(LOL);
  assert.ok(short.truncated);
  assert.match(short.text, /Den Rest findest du im Chat\.$/);
  assert.ok(short.text.length < 600);
  assert.equal(short.parts[0], 'Hinweis: Der League-Client ist aktuell nicht aktiv verbunden.', 'erster Satz allein → Ausgabe startet sofort');
  assert.ok(speakable('Kurz und gut.').parts.length === 1 && !speakable('Kurz und gut.').truncated);
});
