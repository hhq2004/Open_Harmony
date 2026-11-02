import { spawnSync } from 'node:child_process';

const major = Number(process.versions.node.split('.')[0]);
const tools = ['git', 'hdc', 'ohpm', 'hvigorw'].map(name => {
  const probe = process.platform === 'win32'
    ? spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    : spawnSync('which', [name], { encoding: 'utf8', timeout: 10000 });
  return { name, onPath: probe.status === 0 };
});

console.log(JSON.stringify({
  scope: 'host-development',
  nodeVersion: process.versions.node,
  platform: process.platform,
  hostReady: major === 22,
  tools,
  targetValidation: 'not-run',
  note: 'PATH discovery does not establish SDK compatibility, device availability or a working OpenHarmony build.',
}, null, 2));
if (major !== 22) process.exitCode = 1;
