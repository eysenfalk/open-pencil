import { runCommand } from '@open-pencil/package-artifacts'

export async function runPackageQualityCommand(entrypoints: string[]): Promise<void> {
  for (const entrypoint of entrypoints) {
    await runCommand({
      command: 'bun',
      args: [entrypoint],
      cwd: process.cwd(),
      output: 'inherit',
      timeoutMs: 10 * 60_000
    })
  }
}
