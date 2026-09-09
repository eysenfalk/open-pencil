import { randomUUID } from 'node:crypto'
import process from 'node:process'

import { AUTOMATION_HTTP_PORT } from '@open-pencil/core/constants'

import {
  devAutomationRoute,
  type DevAutomationRoute
} from '../src/app/automation/bridge/portless-route'
import { automationPlugin } from '../src/app/automation/bridge/vite-plugin'

const devAutomationAuthToken = process.env.OPENPENCIL_DEV_TOKEN ?? randomUUID()

export function localAutomationToken(command: string): string | null {
  return command === 'serve' ? devAutomationAuthToken : null
}

export function automationCORSOrigin(host: string | undefined): string {
  return host ? `http://${host}:1420` : 'http://localhost:1420'
}

export function resolveDevAutomationRoute(): DevAutomationRoute {
  return devAutomationRoute(process.env.PORTLESS_URL, AUTOMATION_HTTP_PORT, {
    browserURL: process.env.OPENPENCIL_DEV_AUTOMATION_URL,
    corsOrigin: process.env.OPENPENCIL_DEV_ORIGIN
  })
}

export function openPencilAutomationPlugin(
  command: string,
  host: string | undefined,
  route = resolveDevAutomationRoute()
) {
  return automationPlugin(localAutomationToken(command), {
    ...route,
    corsOrigin:
      process.env.PORTLESS_URL || process.env.OPENPENCIL_DEV_ORIGIN
        ? route.corsOrigin
        : automationCORSOrigin(host),
    httpPort: AUTOMATION_HTTP_PORT
  })
}
