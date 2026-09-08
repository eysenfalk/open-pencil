import { fileURLToPath } from 'node:url'

import { runCommand } from '@open-pencil/package-artifacts'

import { publicPackageDirs } from '../packages'

const root = fileURLToPath(new URL('../../../..', import.meta.url))

for (const packageDir of await publicPackageDirs()) {
  await runCommand({
    command: 'bun',
    args: ['publint', packageDir, '--strict'],
    cwd: root,
    timeoutMs: 60_000
  })
}

console.log('Publint package checks passed.')
