import { normalizePhoneNumber } from './phone-normalizer.js';

const CONTENT_SCRIPT_ID = 'cloudsip-domain-click-to-call';
const DEFAULT_BROWSER_SETTINGS = {
  clickToCallEnabled: false,
  clickToCallMode: 'whitelist',
  allowedDomains: [],
  blockedDomains: [],
  defaultCountry: 'NONE',
  crmIntegrationEnabled: false,
  crmAllowedOrigins: []
};

let lastClickToCall = { number: null, at: 0 };

async function browserSettings(){
  return chrome.storage.local.get(DEFAULT_BROWSER_SETTINGS);
}

function effectivePatterns(settings, grantedOrigins = []){
  const blocked = new Set(settings.blockedDomains || []);
  const clickPatterns = settings.clickToCallEnabled
    ? settings.clickToCallMode === 'blacklist' ? grantedOrigins : settings.allowedDomains || []
    : [];
  const crmPatterns = settings.crmIntegrationEnabled ? settings.crmAllowedOrigins || [] : [];
  const source = [...clickPatterns, ...crmPatterns];
  return [...new Set(source)].filter((pattern) => /^https?:\/\//.test(pattern) && !blocked.has(pattern));
}

async function syncContentScripts(){
  try { await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] }); } catch (_error) {}
  const settings = await browserSettings();
  if (!settings.clickToCallEnabled && !settings.crmIntegrationEnabled) return [];
  const permissions = await chrome.permissions.getAll();
  const patterns = effectivePatterns(settings, permissions.origins || []);
  if (!patterns.length) return [];

  await chrome.scripting.registerContentScripts([{
    id: CONTENT_SCRIPT_ID,
    matches: patterns,
    js: ['content-script.js'],
    css: ['content-script.css'],
    runAt: 'document_idle',
    persistAcrossSessions: true
  }]);
  return patterns;
}

function shouldIgnoreDuplicate(number){
  const now = Date.now();
  if (lastClickToCall.number === number && now - lastClickToCall.at < 2000) return true;
  lastClickToCall = { number, at: now };
  return false;
}

async function openCloudSIPWindow(number = '', autoStart = true){
  const query = number ? `?dial=${encodeURIComponent(number)}&autoStart=${autoStart ? '1' : '0'}` : '';
  await chrome.windows.create({ url: chrome.runtime.getURL(`index.html${query}`), type: 'popup', width: 430, height: 760, focused: true });
}

async function openSidePanelAndDial(number, senderTab, autoStart = true, source = 'browser'){
  await chrome.storage.local.set({
    cloudsipPendingDialNumber: number,
    cloudsipPendingDialAt: Date.now(),
    cloudsipPendingDialAutoStart: autoStart,
    cloudsipPendingDialSource: source,
    cloudsipPendingDialTabId: senderTab?.id || null
  });

  if (chrome.sidePanel?.open) {
    try {
      await chrome.sidePanel.open(senderTab?.windowId ? { windowId: senderTab.windowId } : {});
    } catch (error) {
      console.warn('Unable to open CloudSIP side panel', error);
    }
  } else {
    await openCloudSIPWindow(number, autoStart);
  }

  chrome.runtime.sendMessage({ type: 'CLOUDSIP_PENDING_DIAL', number, autoStart, source, tabId: senderTab?.id || null }).catch(() => {});
}

function dialRequestNumber(value){
  const raw = String(value || '').trim();
  if (!/^cloudsip:/i.test(raw)) return raw;
  try { return new URL(raw).searchParams.get('number') || ''; } catch (_error) { return ''; }
}

async function processDialRequest(message, sender){
  const settings = await browserSettings();
  if (message.source === 'crm' && !settings.crmIntegrationEnabled) throw new Error('CRM integration is disabled');
  const number = normalizePhoneNumber(dialRequestNumber(message.number), settings.defaultCountry);
  if (!number) throw new Error('Missing click-to-call number');
  if (shouldIgnoreDuplicate(number)) return { ok: true, ignored: true };
  await openSidePanelAndDial(number, sender.tab, message.autoStart !== false, message.source || 'browser');
  return { ok: true, number };
}

async function createContextMenus(){
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'cloudsip-call-selection', title: 'Call “%s” with CloudSIP', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'cloudsip-call-link', title: 'Call link with CloudSIP', contexts: ['link'] });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true });
  createContextMenus();
  syncContentScripts();
});

chrome.runtime.onStartup.addListener(syncContentScripts);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ['clickToCallEnabled', 'clickToCallMode', 'allowedDomains', 'blockedDomains', 'crmIntegrationEnabled', 'crmAllowedOrigins'].some((key) => changes[key])) syncContentScripts();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const value = info.menuItemId === 'cloudsip-call-selection' ? info.selectionText : info.linkUrl;
  if (info.menuItemId === 'cloudsip-call-link' && !/^(?:tel:|cloudsip:)/i.test(value || '')) return;
  processDialRequest({ number: value, source: 'context-menu', autoStart: true }, { tab }).catch((error) => console.warn('Context-menu call failed', error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CLOUDSIP_APPLY_BROWSER_SETTINGS') {
    syncContentScripts().then((patterns) => sendResponse({ ok: true, patterns })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'CLOUDSIP_CLICK_TO_CALL' || message.type === 'CLOUDSIP_CRM_CALL') {
    processDialRequest({ ...message, source: message.type === 'CLOUDSIP_CRM_CALL' ? 'crm' : message.source }, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'CLOUDSIP_CALL_STATUS' && message.tabId) {
    chrome.tabs.sendMessage(message.tabId, { type: 'CLOUDSIP_CALL_STATUS', status: message.status, number: message.number || '' }).catch(() => {});
    sendResponse({ ok: true });
  }
  return false;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel?.open && tab?.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    return;
  }
  await openCloudSIPWindow();
});
