import { describe, expect, test } from 'bun:test'

import { devAutomationRoute, externalDevServerHost } from '@/app/automation/bridge/portless-route'

describe('private development hosting', () => {
  test('derives the reverse-proxy hostname from the public origin', () => {
    expect(externalDevServerHost('https://server.example.test:1420')).toBe('server.example.test')
    expect(externalDevServerHost(undefined)).toBeUndefined()
  })
})

describe('Portless MCP routing', () => {
  test('uses the fixed localhost bridge outside Portless', () => {
    expect(devAutomationRoute(undefined, 7600)).toEqual({
      browserURL: 'ws://127.0.0.1:7600',
      corsOrigin: 'http://localhost:1420',
      portlessServiceName: null,
      runtimeId: 'localhost-7600'
    })
  })

  test('supports an explicit remote browser bridge for private deployments', () => {
    expect(
      devAutomationRoute(undefined, 7600, {
        browserURL: 'wss://server.example.test:7600',
        corsOrigin: 'https://server.example.test:1420'
      })
    ).toEqual({
      browserURL: 'wss://server.example.test:7600',
      corsOrigin: 'https://server.example.test:1420',
      portlessServiceName: null,
      runtimeId: 'server.example.test:7600'
    })
  })

  test('requires a complete and valid explicit remote route', () => {
    expect(() =>
      devAutomationRoute(undefined, 7600, {
        browserURL: 'wss://server.example.test:7600'
      })
    ).toThrow('requires both browserURL and corsOrigin')
    expect(() =>
      devAutomationRoute(undefined, 7600, {
        browserURL: 'https://server.example.test:7600',
        corsOrigin: 'https://server.example.test:1420'
      })
    ).toThrow('must use ws or wss')
    expect(() =>
      devAutomationRoute(undefined, 7600, {
        browserURL: 'wss://server.example.test:7600',
        corsOrigin: 'https://server.example.test:1420/path'
      })
    ).toThrow('must be an HTTP(S) origin')
  })

  test('derives a sibling MCP service for the main checkout', () => {
    expect(devAutomationRoute('https://open-pencil.localhost', 7600)).toEqual({
      browserURL: 'wss://mcp.open-pencil.localhost',
      corsOrigin: 'https://open-pencil.localhost',
      portlessServiceName: 'mcp.open-pencil',
      runtimeId: 'mcp.open-pencil.localhost'
    })
  })

  test('preserves the worktree prefix for the MCP service', () => {
    expect(devAutomationRoute('https://portless-mcp-routing.open-pencil.localhost', 7600)).toEqual({
      browserURL: 'wss://portless-mcp-routing.mcp.open-pencil.localhost',
      corsOrigin: 'https://portless-mcp-routing.open-pencil.localhost',
      portlessServiceName: 'mcp.open-pencil',
      runtimeId: 'portless-mcp-routing.mcp.open-pencil.localhost'
    })
  })

  test('preserves a nonstandard HTTPS proxy port', () => {
    const route = devAutomationRoute('https://chat-history.open-pencil.localhost:1355', 7600)
    expect(route.browserURL).toBe('wss://chat-history.mcp.open-pencil.localhost:1355')
    expect(route.corsOrigin).toBe('https://chat-history.open-pencil.localhost:1355')
  })

  test('rejects unrelated Portless hostnames', () => {
    expect(() => devAutomationRoute('https://other.localhost', 7600)).toThrow(
      'Unexpected OpenPencil Portless URL'
    )
  })
})
