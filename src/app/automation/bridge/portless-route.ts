export interface DevAutomationRoute {
  browserURL: string
  corsOrigin: string
  portlessServiceName: string | null
  runtimeId: string
}

export interface ExternalDevAutomationRoute {
  browserURL?: string
  corsOrigin?: string
}

const APP_NAME = 'open-pencil'
const MCP_SERVICE_NAME = `mcp.${APP_NAME}`

export function externalDevServerHost(origin: string | undefined): string | undefined {
  return origin ? new URL(origin).hostname : undefined
}

export function devAutomationRoute(
  portlessURL: string | undefined,
  fallbackPort: number,
  external: ExternalDevAutomationRoute = {}
): DevAutomationRoute {
  if (external.browserURL || external.corsOrigin) {
    if (!external.browserURL || !external.corsOrigin) {
      throw new Error('External automation routing requires both browserURL and corsOrigin')
    }
    const browserURL = new URL(external.browserURL)
    const appURL = new URL(external.corsOrigin)
    if (!['ws:', 'wss:'].includes(browserURL.protocol)) {
      throw new Error('External automation browserURL must use ws or wss')
    }
    if (!['http:', 'https:'].includes(appURL.protocol) || appURL.origin !== external.corsOrigin) {
      throw new Error('External automation corsOrigin must be an HTTP(S) origin')
    }
    return {
      browserURL: browserURL.href.replace(/\/$/, ''),
      corsOrigin: appURL.origin,
      portlessServiceName: null,
      runtimeId: browserURL.host
    }
  }

  if (!portlessURL) {
    return {
      browserURL: `ws://127.0.0.1:${fallbackPort}`,
      corsOrigin: 'http://localhost:1420',
      portlessServiceName: null,
      runtimeId: `localhost-${fallbackPort}`
    }
  }

  const appURL = new URL(portlessURL)
  const marker = `${APP_NAME}.`
  const markerIndex = appURL.hostname.lastIndexOf(marker)
  if (markerIndex === -1) throw new Error(`Unexpected OpenPencil Portless URL: ${portlessURL}`)
  const prefix = appURL.hostname.slice(0, markerIndex)
  const suffix = appURL.hostname.slice(markerIndex + APP_NAME.length)
  const mcpHostname = `${prefix}${MCP_SERVICE_NAME}${suffix}`
  return {
    browserURL: `wss://${mcpHostname}${appURL.port ? `:${appURL.port}` : ''}`,
    corsOrigin: appURL.origin,
    portlessServiceName: MCP_SERVICE_NAME,
    runtimeId: mcpHostname
  }
}
