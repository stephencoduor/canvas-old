// Background service worker. It keeps the content script registered on the
// teacher's vanity Canvas domains (granted at runtime through optional host
// permissions) and opens the options page from the toolbar button.

import { getDomains } from '../shared/storage'

const SCRIPT_ID = 'toolkit-vanity-domains'

async function syncRegistrations(): Promise<void> {
  const { user, managed } = await getDomains()
  const hosts = [...new Set([...user, ...managed])].filter(h => !h.endsWith('.instructure.com'))
  const granted: string[] = []
  for (const h of hosts) {
    if (await chrome.permissions.contains({ origins: [`https://${h}/*`] })) granted.push(h)
  }
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] })
  if (!granted.length) return
  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches: granted.map(h => `https://${h}/courses/*`),
      js: ['content.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ])
}

chrome.runtime.onInstalled.addListener(() => void syncRegistrations())
chrome.runtime.onStartup.addListener(() => void syncRegistrations())
chrome.permissions.onAdded.addListener(() => void syncRegistrations())
chrome.permissions.onRemoved.addListener(() => void syncRegistrations())
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'sync' && changes.domains) || area === 'managed') void syncRegistrations()
})
chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage())
chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type === 'open-options') void chrome.runtime.openOptionsPage()
})
