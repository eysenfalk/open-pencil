import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { discoverPublicPackages, orderPackagesByDependencies } from '@open-pencil/package-artifacts'

import {
  assertNoRuntimeSource,
  installPackedPackages,
  overlayPackedPackages,
  packPublicPackages,
  verifyPackageBinaries,
  verifyPublicImports,
  verifyRuntimeScenarios
} from './smoke/artifacts'
import { runtimeScenarios } from './smoke/scenarios'
import { verifyTypeConsumer } from './smoke/type-consumer'

export async function verifyPackedPackages(root: string): Promise<void> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'open-pencil-package-smoke-'))
  try {
    const packages = orderPackagesByDependencies(await discoverPublicPackages(root))
    let consumerDirectory: string | undefined
    for (const packageManager of ['bun', 'npm'] as const) {
      const packageSet = await packPublicPackages(
        root,
        join(temporaryRoot, `${packageManager}-tarballs`),
        packages,
        packageManager
      )
      assertNoRuntimeSource(packageSet.inspections)

      if (!consumerDirectory) {
        consumerDirectory = join(temporaryRoot, 'consumer')
        await installPackedPackages(consumerDirectory, packageSet.tarballs)
      } else {
        await overlayPackedPackages(consumerDirectory, packageSet.inspections)
      }
      const manifests = packageSet.inspections.map(({ manifest }) => manifest)
      await verifyPublicImports(manifests, consumerDirectory)
      await verifyRuntimeScenarios(runtimeScenarios, consumerDirectory)
      await verifyTypeConsumer(root, consumerDirectory)
      await verifyPackageBinaries(consumerDirectory)
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  await verifyPackedPackages(root)
  console.log('npm and Bun package artifacts pass installed Node and Bun verification.')
}
