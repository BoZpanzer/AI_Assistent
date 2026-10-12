# Updates (signiert)

JARVIS prüft – falls eingerichtet – täglich eine Update-Kanal-URL (Einstellungen → Daten, Sicherung & Updates). Automatisch installiert werden **nur** Updates, deren Manifest mit dem in der App hinterlegten öffentlichen Schlüssel signiert ist; zusätzlich muss die SHA-256-Prüfsumme der heruntergeladenen Datei stimmen. Vor der Installation erstellt JARVIS eine Sicherung.

## Einmalig: Schlüsselpaar erzeugen

```bash
node -e "const c=require('crypto');const k=c.generateKeyPairSync('ed25519');require('fs').writeFileSync('update-private-key.pem',k.privateKey.export({type:'pkcs8',format:'pem'}));require('fs').writeFileSync('build/update-public-key.pem',k.publicKey.export({type:'spki',format:'pem'}))"
```

`build/update-public-key.pem` wird beim Build in die App eingebettet. **`update-private-key.pem` niemals einchecken oder weitergeben.**

## Pro Release: Manifest signieren

```bash
node -e "
const c=require('crypto'),fs=require('fs');
const version='3.0.1', url='https://DEIN-HOST/JARVIS_Setup.exe';
const sha=c.createHash('sha256').update(fs.readFileSync('release/JARVIS_Setup.exe')).digest('hex');
const sig=c.sign(null,Buffer.from(version+'\n'+sha+'\n'+url),fs.readFileSync('update-private-key.pem')).toString('base64');
fs.writeFileSync('update-channel.json',JSON.stringify({version,url,sha256:sha,notes:'',signature:sig},null,2));"
```

`update-channel.json` und `JARVIS_Setup.exe` per https hosten (z. B. GitHub Releases) und die URL der JSON-Datei in JARVIS eintragen. Ohne Signatur zeigt JARVIS das Update nur an und sperrt die automatische Installation.

**Code-Signatur der EXE (Authenticode)** ist davon unabhängig und braucht ein kostenpflichtiges Zertifikat; ohne sie zeigt Windows SmartScreen beim ersten Start „Unbekannter Herausgeber“.
