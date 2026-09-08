import { invoke } from '@tauri-apps/api/core'
import { ref } from 'vue'

/** Explicit user action only: clear the native denial latch without reading secrets. */
export function useCredentialRetry() {
  const busy = ref(false)
  const outcome = ref<'idle' | 'ready' | 'failed'>('idle')
  async function retry() {
    if (busy.value) return
    busy.value = true
    outcome.value = 'idle'
    try {
      await invoke('credential_retry_access')
      outcome.value = 'ready'
    } catch {
      outcome.value = 'failed'
    } finally {
      busy.value = false
    }
  }
  return { busy, outcome, retry }
}
