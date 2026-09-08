import { describe, expect, test } from 'bun:test'

import { packageBinTargets, packageExportTargetPaths } from '../src/tarball'

describe('tarball metadata', () => {
  test('normalizes string and named binaries', () => {
    expect(packageBinTargets({ name: 'example', version: '1', bin: './cli.js' })).toEqual({
      example: './cli.js'
    })
    expect(
      packageBinTargets({ name: 'example', version: '1', bin: { other: './other.js' } })
    ).toEqual({ other: './other.js' })
  })

  test('collects nested and wildcard export targets', () => {
    expect(
      packageExportTargetPaths({
        exports: {
          './feature/*': { types: './dist/*.d.ts', import: ['./dist/*.js', null] }
        }
      })
    ).toEqual(['./dist/*.d.ts', './dist/*.js'])
  })
})
