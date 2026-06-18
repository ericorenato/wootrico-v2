// Generate an Ed25519 keypair for license signing.
// Private key → license-server (LICENSE_PRIVATE_KEY). Public key → instance (LICENSE_PUBLIC_KEY).
// PEMs are base64-encoded to fit on a single env line.
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';

const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
const priv = await exportPKCS8(privateKey);
const pub = await exportSPKI(publicKey);

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

console.log('# license-server env:');
console.log(`LICENSE_PRIVATE_KEY=${b64(priv)}`);
console.log(`LICENSE_PUBLIC_KEY=${b64(pub)}`);
console.log('\n# instance (.env) env:');
console.log(`LICENSE_PUBLIC_KEY=${b64(pub)}`);
