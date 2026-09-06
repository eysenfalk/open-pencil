#!/usr/bin/env bun
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { captureGraphOracle, figmaOracleScript } from '#visual/capture-scene'
import { compareSceneOracle, type SceneOracleNode } from '#visual/scene-oracle'
import { $ } from 'bun'

import { materializeDocument, parseFigBuffer } from '@open-pencil/fig'

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    node: { type: 'string' },
    'figma-key': { type: 'string' },
    output: { type: 'string' }
  }
})
if (!values.file || !values.node || !values['figma-key'] || !values.output) {
  throw new Error('Required: --file FILE --node ID --figma-key KEY --output DIR')
}
await mkdir(values.output, { recursive: true })
const script = figmaOracleScript(values['figma-key'], values.node)
const capture = await $`figma-use eval ${script} --json`.quiet().text()
const oracle = JSON.parse(capture) as { fileKey: string; rootId: string; nodes: SceneOracleNode[] }
if (
  oracle.fileKey !== values['figma-key'] ||
  oracle.rootId !== values.node ||
  !Array.isArray(oracle.nodes)
) {
  throw new Error('Invalid oracle capture identity')
}
const { nodeChanges, blobs } = parseFigBuffer(await Bun.file(values.file).arrayBuffer())
const diagnostics: unknown[] = []
const { graph, sources } = materializeDocument(nodeChanges, blobs, {
  derivedBounds: true,
  onUnresolvedProperty: (diagnostic) => diagnostics.push(diagnostic)
})
const root = sources.get(values.node)
if (!root) throw new Error('Missing assembled root')
const actual = captureGraphOracle(graph, root, sources)
const differences = compareSceneOracle(oracle.nodes, actual)
for (const [name, value] of Object.entries({ oracle, actual, differences, diagnostics })) {
  await Bun.write(join(values.output, `${name}.json`), JSON.stringify(value, null, 2))
}
const counts: Record<string, number> = {}
for (const difference of differences)
  counts[difference.category] = (counts[difference.category] ?? 0) + 1
console.log(
  JSON.stringify(
    {
      expectedNodes: oracle.nodes.length,
      actualNodes: actual.length,
      differences: counts,
      unresolvedCallbacks: diagnostics.length
    },
    null,
    2
  )
)
if (differences.length) process.exitCode = 1
