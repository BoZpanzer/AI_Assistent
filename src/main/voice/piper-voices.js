'use strict';
/**
 * Deutsche Piper-Stimmen (https://huggingface.co/rhasspy/piper-voices, Version v1.0.0) mit festen
 * SHA-256-Prüfsummen. Nur Stimmen mit klarer, freier Lizenz (CC0 / CC BY 4.0).
 * Die Standardstimme liegt im Installer; die übrigen werden nur auf ausdrücklichen Klick geladen.
 */
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/de/de_DE/';
const files = (dir, id, onnx, json) => [
  { name: id + '.onnx', url: HF + dir + '/' + id + '.onnx', size: onnx[0], sha256: onnx[1] },
  { name: id + '.onnx.json', url: HF + dir + '/' + id + '.onnx.json', size: json[0], sha256: json[1] },
];

const VOICES = Object.freeze([
  { id: 'de_DE-thorsten-medium', label: 'Thorsten (männlich, natürlich)', quality: 'gut · schnell', license: 'CC0', bundled: true,
    files: files('thorsten/medium', 'de_DE-thorsten-medium', [63201294, '7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819'], [4819, '974adee790533adb273a1ac88f49027d2a1b8f0f2cf4905954a4791e79264e85']) },
  { id: 'de_DE-thorsten-high', label: 'Thorsten HD (männlich, beste Qualität)', quality: 'sehr gut · etwa 4× langsamer', license: 'CC0',
    files: files('thorsten/high', 'de_DE-thorsten-high', [113895201, '9df1c43c61149ef9b39e618e2b861fbe41e1fcea9390b2dac62e8761573ea4f1'], [4875, '6de734444e4c3f9e33b7ebe2746dbc19b71e85f613e79c65acf623200b99a76a']) },
  { id: 'de_DE-thorsten_emotional-medium', label: 'Thorsten mit Stimmungen', quality: 'gut · schnell', license: 'CC0',
    styles: [['neutral', 'Neutral'], ['amused', 'Belustigt'], ['surprised', 'Überrascht'], ['sleepy', 'Müde'], ['whisper', 'Flüstern'], ['angry', 'Wütend'], ['disgusted', 'Angewidert'], ['drunk', 'Betrunken']],
    files: files('thorsten_emotional/medium', 'de_DE-thorsten_emotional-medium', [76745905, 'c1764e652266cd6dcebf1b95c61973df5970a5f5272e94b655ff1ddf9a99d1ff'], [5031, '92895b9e99f7cfc13f4a9879da615c3d6e0baa4d660e26d7b685abdd27a6d1d3']) },
  { id: 'de_DE-kerstin-low', label: 'Kerstin (weiblich)', quality: 'ordentlich · schnell', license: 'CC0',
    files: files('kerstin/low', 'de_DE-kerstin-low', [63104526, 'd352a7641892cebf2903859af94e9ba81a141110215fe3943bcda7f7da401b7a'], [4158, '56e708556b7b9b7a53c4f8957e021421e69f11a600962bba554cffbe72cf2d47']) },
  { id: 'de_DE-mls-medium', label: 'Viele Sprecher (Frauen und Männer)', quality: 'unterschiedlich · schnell', license: 'CC BY 4.0 (Multilingual LibriSpeech)', speakers: 236,
    files: files('mls/medium', 'de_DE-mls-medium', [76961079, '69cd1d2aa5a35839a518966fcc4924b5f93e5f8c948ed0752b1a616ad53f65bf'], [8948, 'b0af1c89ddfdc72d32e015729b0e89b99eec13c2c8caa1db7488d98e9e570b40']) },
]);
const DEFAULT_VOICE = 'de_DE-thorsten-medium';

module.exports = { VOICES, DEFAULT_VOICE };
