import { strict as assert } from 'node:assert'

declare global {
  interface Window {
    __TAURI__: { core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } }
  }
}

describe('native test credential isolation', () => {
  it('uses disposable memory credentials and exposes explicit retry without Keychain access', async () => {
    await browser.waitUntil(
      async () => browser.execute(() => Boolean(window.openPencil?.getStore?.())),
      { timeout: 30_000 }
    )
    const previousLaunch = await browser.execute(() => {
      // Probe the WebView storage itself: an app storage adapter would not prove profile isolation.
      // oxlint-disable-next-line open-pencil/no-direct-storage-access
      const previous = localStorage.getItem('native-test-launch-marker')
      // oxlint-disable-next-line open-pencil/no-direct-storage-access
      localStorage.setItem('native-test-launch-marker', 'present')
      return previous
    })
    assert.equal(previousLaunch, null)
    assert.equal(await $('[role="alertdialog"]').isExisting(), false)
    const result = await browser.execute(async () => {
      const invoke = window.__TAURI__.core.invoke
      const reference = { integrationId: 'native-test', profileId: 'isolation', field: 'api-key' }
      await invoke('credential_retry_access')
      const before = await invoke('credential_status', { reference })
      await invoke('credential_write', { reference, value: 'disposable-test-value' })
      const after = await invoke('credential_status', { reference })
      await invoke('credential_remove', { reference })
      const removed = await invoke('credential_status', { reference })
      return { before, after, removed }
    })
    assert.deepEqual(result, { before: 'missing', after: 'configured', removed: 'missing' })
  })

  it('offers explicit retry from the Settings footer', async () => {
    await browser.keys([process.platform === 'darwin' ? 'Meta' : 'Control', ','])
    const retry = await $('button=Retry credential access')
    await retry.waitForDisplayed()
    await retry.click()
    const status = await $('[role="status"]')
    await status.waitForDisplayed()
    assert.match(await status.getText(), /Access can be requested again/)
  })
})
