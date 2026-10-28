const { localPronunciation } = require('../src/main/voice/speech');
const { REF_TEXT } = require('../src/main/voice/omnivoice');
const T = 'Alles klar, Chef. Euer Jungler steht oben, also ist Bot gerade sicher. Hol dir zwei Wards, warte auf dein Ultimate und dann gänkt ihr gemeinsam am Drachen.';
require('fs').writeFileSync(__dirname + '/text.json', JSON.stringify({ said: localPronunciation(T), raw: T, refText: REF_TEXT }));
console.log(localPronunciation(T));
