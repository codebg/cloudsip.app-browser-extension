import { defaultConfig } from './default-config.js';

const STORAGE_KEY = 'cloudsip_phone_settings';
const SESSION_PASSWORD_KEY = 'cloudsip_phone_session_password';
const CALL_LOGS_STORAGE_KEY = 'cloudsip_phone_call_logs';
const RECORDINGS_STORAGE_KEY = 'cloudsip_phone_recordings';

export const defaultSettings = Object.freeze({
  companyWebsite: defaultConfig.companyWebsite,
  extension: defaultConfig.sip.extension,
  sipDomain: defaultConfig.sip.sipDomain,
  websocketUrl: defaultConfig.sip.websocketUrl,
  sipUri: defaultConfig.sip.sipUri,
  displayName: defaultConfig.sip.displayName,
  password: defaultConfig.sip.password,
  iceServers: defaultConfig.sip.iceServers,
  sessionTimers: defaultConfig.sip.sessionTimers,
  rememberPassword: true,
  autoAnswer: defaultConfig.settings.autoAnswer,
  autoRecordCalls: defaultConfig.settings.autoRecordCalls,
  autoHoldOnSwitch: defaultConfig.settings.autoHoldOnSwitch,
  transferMode: 'blind',
  callWaiting: true,
  dialPlanRules: '',
  ringtoneStyle: 'classic',
  headsetControls: false,
  sipMessageEnabled: false,
  blfEnabled: false,
  clickToCallEnabled: defaultConfig.settings.clickToCallEnabled ?? false,
  clickToCallAutoDial: defaultConfig.settings.clickToCallAutoDial ?? false,
  clickToCallMode: 'whitelist',
  allowedDomains: [],
  blockedDomains: [],
  defaultCountry: 'NONE',
  crmIntegrationEnabled: false,
  crmAllowedOrigins: [],
  theme: defaultConfig.settings.theme,
  audioDevices: {
    inputDeviceId: '',
    outputDeviceId: '',
    ringtoneDeviceId: ''
  }
});

function hasLocalStorage(){
  try {
    if (!globalThis.localStorage) return false;
    const testKey = `${STORAGE_KEY}_test`;
    globalThis.localStorage.setItem(testKey, testKey);
    globalThis.localStorage.removeItem(testKey);
    return true;
  } catch (error) {
    return false;
  }
}

function hasSessionStorage(){
  try {
    return Boolean(globalThis.sessionStorage);
  } catch (error) {
    return false;
  }
}

function normalizeSettings(settings = {}){
  const nextSettings = {
    ...defaultSettings,
    ...settings,
    audioDevices: {
      ...defaultSettings.audioDevices,
      ...(settings.audioDevices || {})
    }
  };

  nextSettings.companyWebsite = String(nextSettings.companyWebsite || '').trim() || defaultSettings.companyWebsite;
  nextSettings.extension = String(nextSettings.extension || '').trim() || defaultSettings.extension;
  nextSettings.sipDomain = String(nextSettings.sipDomain || '').trim() || defaultSettings.sipDomain;
  nextSettings.websocketUrl = String(nextSettings.websocketUrl || '').trim() || defaultSettings.websocketUrl;
  nextSettings.sipUri = String(nextSettings.sipUri || '').trim() || `sip:${nextSettings.extension}@${nextSettings.sipDomain}`;
  nextSettings.displayName = String(nextSettings.displayName || '').trim() || nextSettings.extension;
  nextSettings.password = String(nextSettings.password || '');
  nextSettings.iceServers = Array.isArray(nextSettings.iceServers)
    ? nextSettings.iceServers.map((server) => ({
        urls: Array.isArray(server?.urls)
          ? server.urls.map((url) => String(url || '').trim()).filter(Boolean)
          : String(server?.urls || '').split(/[\n,]+/).map((url) => url.trim()).filter(Boolean),
        username: String(server?.username || ''),
        credential: String(server?.credential || '')
      })).filter((server) => server.urls.length)
    : [];
  nextSettings.sessionTimers = nextSettings.sessionTimers !== false;
  nextSettings.rememberPassword = nextSettings.rememberPassword !== false;
  nextSettings.autoAnswer = Boolean(nextSettings.autoAnswer);
  nextSettings.autoRecordCalls = Boolean(nextSettings.autoRecordCalls);
  nextSettings.autoHoldOnSwitch = Boolean(nextSettings.autoHoldOnSwitch);
  nextSettings.transferMode = nextSettings.transferMode === 'attended' ? 'attended' : 'blind';
  nextSettings.callWaiting = nextSettings.callWaiting !== false;
  nextSettings.dialPlanRules = String(nextSettings.dialPlanRules || '');
  nextSettings.ringtoneStyle = nextSettings.ringtoneStyle === 'silent' ? 'silent' : 'classic';
  nextSettings.headsetControls = Boolean(nextSettings.headsetControls);
  nextSettings.sipMessageEnabled = Boolean(nextSettings.sipMessageEnabled);
  nextSettings.blfEnabled = Boolean(nextSettings.blfEnabled);
  nextSettings.clickToCallEnabled = Boolean(nextSettings.clickToCallEnabled);
  nextSettings.clickToCallAutoDial = Boolean(nextSettings.clickToCallAutoDial);
  nextSettings.clickToCallMode = nextSettings.clickToCallMode === 'blacklist' ? 'blacklist' : 'whitelist';
  nextSettings.allowedDomains = Array.isArray(nextSettings.allowedDomains) ? nextSettings.allowedDomains.map(String).filter(Boolean) : [];
  nextSettings.blockedDomains = Array.isArray(nextSettings.blockedDomains) ? nextSettings.blockedDomains.map(String).filter(Boolean) : [];
  nextSettings.defaultCountry = ['NONE', 'AL', 'IT', 'GB', 'DE', 'FR', 'US'].includes(nextSettings.defaultCountry) ? nextSettings.defaultCountry : 'NONE';
  nextSettings.crmIntegrationEnabled = Boolean(nextSettings.crmIntegrationEnabled);
  nextSettings.crmAllowedOrigins = Array.isArray(nextSettings.crmAllowedOrigins) ? nextSettings.crmAllowedOrigins.map(String).filter(Boolean) : [];
  nextSettings.theme = nextSettings.theme === 'dark' ? 'dark' : 'light';

  return nextSettings;
}

function readStoredSettings(){
  if (!hasLocalStorage()) return {};

  try {
    const parsed = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY) || '{}');
    const settings = parsed && typeof parsed === 'object' ? parsed : {};
    if (settings.rememberPassword === false && hasSessionStorage()) {
      settings.password = globalThis.sessionStorage.getItem(SESSION_PASSWORD_KEY) || '';
    }
    return settings;
  } catch (error) {
    console.warn('Unable to parse stored phone settings', error);
    return {};
  }
}

function dispatchSettingsChanged(settings){
  if (typeof globalThis.dispatchEvent !== 'function') return;
  const event = typeof CustomEvent === 'function'
    ? new CustomEvent('settings:changed', { detail: { settings } })
    : new Event('settings:changed');
  globalThis.dispatchEvent(event);
}

export function getSettings(){
  return normalizeSettings({
    ...defaultSettings,
    ...readStoredSettings()
  });
}

export function saveSettings(settings){
  const nextSettings = normalizeSettings(settings);

  if (hasLocalStorage()) {
    const persistentSettings = nextSettings.rememberPassword === false
      ? { ...nextSettings, password: '' }
      : nextSettings;
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistentSettings));
  }

  if (hasSessionStorage()) {
    if (nextSettings.rememberPassword === false && nextSettings.password) {
      globalThis.sessionStorage.setItem(SESSION_PASSWORD_KEY, nextSettings.password);
    } else {
      globalThis.sessionStorage.removeItem(SESSION_PASSWORD_KEY);
    }
  }

  if (globalThis.chrome?.storage?.local) {
    globalThis.chrome.storage.local.set({
      clickToCallEnabled: nextSettings.clickToCallEnabled,
      clickToCallAutoDial: nextSettings.clickToCallAutoDial,
      clickToCallMode: nextSettings.clickToCallMode,
      allowedDomains: nextSettings.allowedDomains,
      blockedDomains: nextSettings.blockedDomains,
      defaultCountry: nextSettings.defaultCountry,
      crmIntegrationEnabled: nextSettings.crmIntegrationEnabled,
      crmAllowedOrigins: nextSettings.crmAllowedOrigins
    });
  }

  dispatchSettingsChanged(nextSettings);
  return nextSettings;
}

export function updateSetting(key, value){
  return saveSettings({
    ...getSettings(),
    [key]: value
  });
}

export function resetSettings(){
  return saveSettings({ ...defaultSettings });
}

export function clearLocalData(){
  if (hasLocalStorage()) {
    globalThis.localStorage.removeItem(CALL_LOGS_STORAGE_KEY);
    globalThis.localStorage.removeItem(RECORDINGS_STORAGE_KEY);
  }

  if (typeof globalThis.dispatchEvent === 'function') {
    const event = typeof CustomEvent === 'function'
      ? new CustomEvent('calllogs:changed')
      : new Event('calllogs:changed');
    globalThis.dispatchEvent(event);
  }
}
