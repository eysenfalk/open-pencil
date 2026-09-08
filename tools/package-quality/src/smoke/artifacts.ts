import { mkdir, readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'

import {
  concreteImportSpecifiers,
  runCommand,
  type PackageManifest,
  type WorkspacePackage
} from '@open-pencil/package-artifacts'
import { inspectTarball, type TarballInspection } from '@open-pencil/package-artifacts/tarball'

export type RuntimeName = 'bun' | 'node'

export interface PackedPackageSet {
  inspections: TarballInspection[]
  packages: WorkspacePackage[]
  tarballs: string[]
}

const RUNTIME_TIMEOUT_MS = 30_000

function tarballFromOutput(output: string, directory: string): string {
  const filename = output
    .split('\n')
    .map((line: string) => line.trim())
    .reverse()
    .find((line: string) => line.endsWith('.tgz'))
  if (!filename) throw new Error(`Package manager did not report a tarball in ${directory}`)
  return filename.startsWith('/') ? filename : join(directory, filename)
}

export async function packPublicPackages(
  root: string,
  outputDirectory: string,
  packages: WorkspacePackage[],
  packageManager: 'bun' | 'npm'
): Promise<PackedPackageSet> {
  await mkdir(outputDirectory, { recursive: true })
  const tarballs: string[] = []
  for (const pkg of packages) {
    const command =
      packageManager === 'bun'
        ? ['bun', 'pm', 'pack', '--ignore-scripts', '--destination', outputDirectory, '--quiet']
        : ['npm', 'pack', '--json', '--ignore-scripts', '--pack-destination', outputDirectory]
    const result = await runCommand({
      command: command[0] ?? packageManager,
      args: command.slice(1),
      cwd: join(root, pkg.directory),
      timeoutMs: 60_000
    })
    const tarball =
      packageManager === 'bun'
        ? tarballFromOutput(result.stdout, outputDirectory)
        : npmTarballFromOutput(result.stdout, outputDirectory, pkg.manifest.name)
    tarballs.push(tarball)
  }
  const inspections = await Promise.all(tarballs.map(inspectTarball))
  const diagnostics = inspections.flatMap(({ diagnostics }) => diagnostics)
  if (diagnostics.length > 0) {
    throw new Error(
      diagnostics
        .map(({ packageName, field, message }) => `${packageName}: ${field} ${message}`)
        .join('\n')
    )
  }
  return { inspections, packages, tarballs }
}

function npmTarballFromOutput(output: string, directory: string, packageName: string): string {
  const result = JSON.parse(output) as Array<{ filename?: string }>
  const filename = result[0]?.filename
  if (!filename) throw new Error(`${packageName}: npm pack did not report a tarball`)
  return join(directory, filename)
}

export async function overlayPackedPackages(
  consumerDirectory: string,
  inspections: TarballInspection[]
): Promise<void> {
  for (const { manifest, tarballPath } of inspections) {
    const segments = manifest.name.split('/')
    const packageDirectory = join(consumerDirectory, 'node_modules', ...segments)
    await rm(packageDirectory, { recursive: true, force: true })
    await mkdir(packageDirectory, { recursive: true })
    await runCommand({
      command: 'tar',
      args: ['-xzf', tarballPath, '-C', packageDirectory, '--strip-components=1'],
      cwd: consumerDirectory,
      timeoutMs: 30_000
    })
  }
}

export async function installPackedPackages(
  consumerDirectory: string,
  tarballs: string[]
): Promise<void> {
  await mkdir(consumerDirectory, { recursive: true })
  await runCommand({ command: 'npm', args: ['init', '-y'], cwd: consumerDirectory })
  await runCommand({
    command: 'npm',
    args: ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs],
    cwd: consumerDirectory,
    timeoutMs: 120_000
  })
}

function runtimeEvalArgs(runtime: RuntimeName, code: string): string[] {
  return runtime === 'node' ? ['--input-type=module', '--eval', code] : ['--eval', code]
}

export async function evaluateRuntime(
  runtime: RuntimeName,
  code: string,
  consumerDirectory: string
): Promise<void> {
  await runCommand({
    command: runtime,
    args: runtimeEvalArgs(runtime, code),
    cwd: consumerDirectory,
    timeoutMs: RUNTIME_TIMEOUT_MS
  })
}

export async function verifyPublicImports(
  manifests: PackageManifest[],
  consumerDirectory: string
): Promise<void> {
  const skipped = new Set(['@open-pencil/mcp/stdio'])
  const specifiers = manifests
    .flatMap(concreteImportSpecifiers)
    .filter((specifier) => !skipped.has(specifier))
    .sort()

  for (const runtime of ['node', 'bun'] as const) {
    for (const specifier of specifiers) {
      await evaluateRuntime(
        runtime,
        `await import(${JSON.stringify(specifier)})`,
        consumerDirectory
      )
    }
  }
}

export async function verifyRuntimeScenarios(
  scenarios: ReadonlyArray<{ code: string }>,
  consumerDirectory: string
): Promise<void> {
  for (const runtime of ['node', 'bun'] as const) {
    for (const scenario of scenarios) {
      await evaluateRuntime(runtime, scenario.code, consumerDirectory)
    }
  }
}

export async function verifyPackageBinaries(consumerDirectory: string): Promise<void> {
  const binaryDirectory = join(consumerDirectory, 'node_modules', '.bin')
  const binaries = (await readdir(binaryDirectory)).filter((name) =>
    ['openpencil', 'openpencil-mcp', 'openpencil-mcp-http'].includes(name)
  )
  for (const runtime of ['node', 'bun'] as const) {
    for (const binary of binaries) {
      await runCommand({
        command: runtime,
        args: [join(binaryDirectory, binary), '--help'],
        cwd: consumerDirectory,
        timeoutMs: RUNTIME_TIMEOUT_MS
      })
    }
  }
}

export function assertNoRuntimeSource(inspections: TarballInspection[]): void {
  const invalid = inspections.flatMap(({ entries, tarballPath }) =>
    [...entries]
      .filter((entry) => /package\/src\/.*\.[cm]?tsx?$/.test(entry) && !/\.d\.[cm]?ts$/.test(entry))
      .map((entry) => `${basename(tarballPath)}: ${entry}`)
  )
  if (invalid.length > 0) throw new Error(`Tarballs include runtime source:\n${invalid.join('\n')}`)
}
