import { fileURLToPath } from 'node:url'

import { discoverPublicPackages } from '@open-pencil/package-artifacts'

const root = fileURLToPath(new URL('../../..', import.meta.url))

export async function publicPackageDirs(): Promise<string[]> {
  return (await discoverPublicPackages(root)).map(({ directory }) => directory)
}
