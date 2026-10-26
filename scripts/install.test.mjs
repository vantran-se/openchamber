import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';

const installer = fileURLToPath(new URL('./install.sh', import.meta.url));

const executable = (directory, name, body) => {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, `#!/bin/sh\nset -eu\n${body}\n`, { mode: 0o755 });
};

const packageManagerCases = [
  {
    name: 'npm',
    list: 'list -g --depth=0',
    removeLegacy: 'uninstall -g @openchamber/web',
    installFork: 'install -g @vantran-se/openchamber-web',
  },
  {
    name: 'pnpm',
    list: 'list -g --depth=0',
    removeLegacy: 'remove -g @openchamber/web',
    installFork: 'add -g @vantran-se/openchamber-web',
  },
  {
    name: 'yarn',
    list: 'global list --depth=0',
    removeLegacy: 'global remove @openchamber/web',
    installFork: 'global add @vantran-se/openchamber-web',
  },
  {
    name: 'bun',
    list: 'pm ls -g',
    removeLegacy: 'remove -g @openchamber/web',
    installFork: 'add -g @vantran-se/openchamber-web',
  },
];

const fixture = (pm, { failForkInstall = false, binaryOnPath = true } = {}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-install-'));
  const state = path.join(directory, 'state');
  const log = path.join(directory, 'log');
  fs.writeFileSync(state, 'legacy');
  executable(directory, 'node', 'echo v24.14.0');
  if (binaryOnPath) executable(directory, 'openchamber', 'echo "legacy updater must not run" >&2; exit 99');
  executable(directory, pm.name, `
case "$*" in
  "${pm.list}")
    case "$(cat '${state}')" in
      legacy) echo '@openchamber/web@2.5.0' ;;
      fork) echo '@vantran-se/openchamber-web@2.5.2' ;;
    esac
    ;;
  "${pm.removeLegacy}") echo "$*" >> '${log}'; : > '${state}' ;;
  "${pm.installFork}") echo "$*" >> '${log}'; ${failForkInstall ? 'exit 1' : `echo fork > '${state}'`} ;;
  "${pm.name === 'npm' ? 'uninstall' : pm.name === 'yarn' ? 'global remove' : 'remove'} -g @vantran-se/openchamber-web") echo "$*" >> '${log}'; : > '${state}' ;;
  "${pm.name === 'npm' ? 'install' : pm.name === 'yarn' ? 'global add' : 'add'} -g @openchamber/web@2.5.0") echo "$*" >> '${log}'; echo legacy > '${state}' ;;
  "--version") echo 9.0.0 ;;
  *) exit 1 ;;
esac`);
  return { directory, state, log };
};

for (const pm of packageManagerCases) {
  test(`migrates a legacy ${pm.name} install to the fork package`, () => {
    const { directory, state, log } = fixture(pm, { binaryOnPath: pm.name !== 'npm' });

    execFileSync('/bin/bash', [installer], {
      env: { ...process.env, PATH: `${directory}:/usr/bin:/bin`, HOME: directory, TERM: 'dumb' },
      stdio: 'pipe',
    });

    assert.equal(fs.readFileSync(log, 'utf8'), `${pm.removeLegacy}\n${pm.installFork}\n`);
    assert.equal(fs.readFileSync(state, 'utf8').trim(), 'fork');
  });
}

test('restores the exact legacy package when installer migration fails', () => {
  const pm = packageManagerCases[0];
  const { directory, state, log } = fixture(pm, { failForkInstall: true });

  const result = spawnSync('/bin/bash', [installer], {
    env: { ...process.env, PATH: `${directory}:/usr/bin:/bin`, HOME: directory, TERM: 'dumb' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /restored @openchamber\/web@2\.5\.0/);
  assert.equal(fs.readFileSync(log, 'utf8'), [
    pm.removeLegacy,
    pm.installFork,
    'uninstall -g @vantran-se/openchamber-web',
    'install -g @openchamber/web@2.5.0',
    '',
  ].join('\n'));
  assert.equal(fs.readFileSync(state, 'utf8').trim(), 'legacy');
});
