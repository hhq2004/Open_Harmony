import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'harmony-app/entry/src/main/ets/core');
const sources = [
  'contracts.ts',
  'application/visit-collector.ts',
  'prediction/validation.ts',
  'prediction/config.ts',
  'prediction/markov.ts',
  'prediction/session.ts',
  'prediction/factory.ts',
  'prediction/index.ts',
];

for (const name of sources) {
  const source = await readFile(resolve(root, 'src', name), 'utf8');
  const adapted = source.replace(/(from\s+['"][^'"]+)\.js(['"])/g, '$1$2');
  const target = resolve(output, name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, adapted);
}
const profile = JSON.parse(await readFile(resolve(root, 'config/prediction.json'), 'utf8'));
await writeFile(resolve(output, 'prediction-profile.ts'), `// Generated from config/prediction.json by scripts/sync-harmony.mjs\nexport const predictionProfile = ${JSON.stringify(profile, null, 2)};\n`);
console.log('Synchronized A/B logic and prediction profile for the ArkTS build.');
