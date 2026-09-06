import { ref } from 'vue'

import { pollCloudDeviceToken, requestCloudDeviceAuthorization } from '@open-pencil/cloud/client'
import type { CloudDiscovery } from '@open-pencil/cloud/contract'

import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'
import { openExternalURL } from '@/app/tauri/opener'

import type { CloudConnectionProfile } from '../instances/profiles'

export type CloudDeviceAuthState =
  | { status: 'idle' }
  | { status: 'waiting'; userCode: string; verificationURL: string; expiresAt: number }
  | { status: 'authorized' }
  | { status: 'denied' | 'expired' | 'error'; message: string }

export type DeviceAuthorizationDependencies = {
  request: typeof requestCloudDeviceAuthorization
  poll: typeof pollCloudDeviceToken
  open: typeof openExternalURL
  save(profileId: string, token: string): Promise<void>
  clear(profileId: string): Promise<void>
}

const defaultDependencies: DeviceAuthorizationDependencies = {
  request: requestCloudDeviceAuthorization,
  poll: pollCloudDeviceToken,
  open: openExternalURL,
  save: (id, token) =>
    appCredentialServices.manager.set(credentialRef('openpencil-cloud', 'session', id), token),
  clear: (id) =>
    appCredentialServices.manager.clear(credentialRef('openpencil-cloud', 'session', id))
}

/** Owns device authorization lifetime independently of the currently selected settings page. */
export function createDeviceAuthorizationSession(
  dependencies: DeviceAuthorizationDependencies = defaultDependencies
) {
  const state = ref<Record<string, CloudDeviceAuthState>>({})
  const controllers = new Map<string, AbortController>()
  const cleanupFailures = new WeakSet<AbortSignal>()
  const credentialWrites = new Map<string, Promise<void>>()

  async function persist(id: string, token: string, signal: AbortSignal): Promise<void> {
    const previous = credentialWrites.get(id) ?? Promise.resolve()
    const write = previous
      .catch(() => undefined)
      .then(async () => {
        signal.throwIfAborted()
        await dependencies.save(id, token)
        if (signal.aborted) {
          // Serialize rollback with subsequent writes so an old attempt cannot erase a new token.
          try {
            await dependencies.clear(id)
          } catch (error) {
            cleanupFailures.add(signal)
            throw error
          }
          signal.throwIfAborted()
        }
        return undefined
      })
    credentialWrites.set(id, write)
    try {
      await write
    } finally {
      if (credentialWrites.get(id) === write) credentialWrites.delete(id)
    }
  }
  function publish(id: string, value: CloudDeviceAuthState) {
    state.value = { ...state.value, [id]: value }
  }
  function cancel(id: string) {
    controllers.get(id)?.abort(new DOMException('Authorization cancelled', 'AbortError'))
    controllers.delete(id)
    publish(id, { status: 'idle' })
  }
  async function authorize(
    discovery: CloudDiscovery,
    profile: CloudConnectionProfile
  ): Promise<boolean> {
    cancel(profile.id)
    const controller = new AbortController()
    controllers.set(profile.id, controller)
    try {
      const authorization = await dependencies.request(discovery, profile.id)
      controller.signal.throwIfAborted()
      publish(profile.id, {
        status: 'waiting',
        userCode: authorization.user_code,
        verificationURL: authorization.verification_uri_complete,
        expiresAt: Date.now() + authorization.expires_in * 1000
      })
      await dependencies.open(authorization.verification_uri_complete)
      controller.signal.throwIfAborted()
      const token = await dependencies.poll(discovery, profile.id, authorization, {
        signal: controller.signal
      })
      controller.signal.throwIfAborted()
      await persist(profile.id, token.access_token, controller.signal)
      controller.signal.throwIfAborted()
      publish(profile.id, { status: 'authorized' })
      return true
    } catch (error) {
      if (controller.signal.aborted) {
        if (cleanupFailures.has(controller.signal) && !controllers.has(profile.id)) {
          publish(profile.id, {
            status: 'error',
            message:
              'Authorization was cancelled, but its saved credential could not be removed. Sign out to retry cleanup.'
          })
        }
        return false
      }
      const message = error instanceof Error ? error.message : String(error)
      const lowered = message.toLowerCase()
      let status: 'expired' | 'denied' | 'error' = 'error'
      if (lowered.includes('expired')) status = 'expired'
      else if (lowered.includes('denied')) status = 'denied'
      publish(profile.id, { status, message })
      return false
    } finally {
      if (controllers.get(profile.id) === controller) controllers.delete(profile.id)
    }
  }
  async function cancelAndWait(id: string): Promise<void> {
    cancel(id)
    await credentialWrites.get(id)?.catch(() => undefined)
  }
  return { state, cancel, cancelAndWait, authorize }
}
