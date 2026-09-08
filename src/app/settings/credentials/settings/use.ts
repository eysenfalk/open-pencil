import { invoke } from '@tauri-apps/api/core'
import { computed, ref, watch } from 'vue'

import { IS_TAURI } from '@open-pencil/core/constants'

import { nativeCredentialAccessRevision, invalidateNativeCredentialAccess } from '../access-state'
import { browserCredentialsRemembered } from '../app'
import { setRememberCredentials } from '../media'

export function useCredentialSettings() {
  const busy = ref(false)
  const paused = ref(false)
  const failed = ref(false)
  const remembered = computed({
    get: () => browserCredentialsRemembered.value,
    set: (value) => {
      void setRememberCredentials(value).catch(() => {
        failed.value = true
      })
    }
  })
  watch(
    nativeCredentialAccessRevision,
    async (_, __, onCleanup) => {
      if (!IS_TAURI) return
      const cancellation = new AbortController()
      onCleanup(() => cancellation.abort())
      try {
        const value = await invoke<boolean>('credential_access_paused')
        if (!cancellation.signal.aborted) paused.value = value
      } catch {
        if (!cancellation.signal.aborted) failed.value = true
      }
    },
    { immediate: true }
  )
  async function retry() {
    if (busy.value) return
    busy.value = true
    failed.value = false
    try {
      await invoke('credential_retry_access')
      paused.value = false
      invalidateNativeCredentialAccess()
    } catch {
      failed.value = true
    } finally {
      busy.value = false
    }
  }
  return { busy, paused, failed, remembered, retry }
}
