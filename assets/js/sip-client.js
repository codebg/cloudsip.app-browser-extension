import { applyAudioDevicesToMedia, getSelectedAudioDevices, requestMicrophonePermission } from './audio-devices.js';
import { showError, showSuccess, showWarning } from './toast.js';
import { runBrowserChecks } from './browser-check.js';
import { getUserPresence } from './presence.js';
import { registrationFailureIsPermanent, recoveryStatus, retryDelay } from './sip-recovery-policy.js';
let sipUA = null;
let sipConfig = null;
let registered = false;
let started = false;
let eventHandlers = {};
let currentAudioSession = null;
let recoveryBound = false;
let lastWakeCheck = Date.now();
let registrationRetryTimer = null;
let transportWatchdogTimer = null;
let registrationRetryAttempt = 0;
let manualShutdown = false;
let lastRegistrationFailure = '';
let registrationInFlight = false;
let registrationStartedAt = 0;
let connectionEvents = [];

const sessionEvents = ['progress', 'accepted', 'confirmed', 'ended', 'failed', 'bye', 'rejected', 'canceled'];

const statusClasses = ['is-online', 'is-offline', 'is-failed'];

function getElement(id){
  return document.getElementById(id);
}

function getExtension(){
  return sipConfig?.extension || '-';
}

function getConnectionLabel(status){
  const extension = getExtension();
  return `WSS · ${extension} · ${status}`;
}

function setConnectionInfo(status){
  const connectionInfo = getElement('connectionInfo');
  if (connectionInfo) connectionInfo.textContent = getConnectionLabel(status);
}

function setConnectionInfoText(text){
  const connectionInfo = getElement('connectionInfo');
  if (connectionInfo) connectionInfo.textContent = text;
}

function setSipStatus(text, dotClass){
  const sipStatusText = getElement('sipStatusText');
  const sipStatusDot = getElement('sipStatusDot');

  if (sipStatusText) sipStatusText.textContent = text;
  window.dispatchEvent(new CustomEvent('sip:status', { detail: { text, dotClass } }));

  if (sipStatusDot) {
    sipStatusDot.classList.remove(...statusClasses);
    if (dotClass) sipStatusDot.classList.add(dotClass);
  }
}

function setOffline(){
  registered = false;
  registrationInFlight = false;
  registrationStartedAt = 0;
  console.log("SIP registered", registered);
  setSipStatus('Offline', 'is-offline');
}

function recordConnectionEvent(type, detail = ''){
  connectionEvents.push({ at: new Date().toISOString(), type, detail: String(detail || '') });
  connectionEvents = connectionEvents.slice(-30);
}

function clearRecoveryTimer(name){
  if (name === 'registration' && registrationRetryTimer) {
    clearTimeout(registrationRetryTimer);
    registrationRetryTimer = null;
  }
  if (name === 'transport' && transportWatchdogTimer) {
    clearTimeout(transportWatchdogTimer);
    transportWatchdogTimer = null;
  }
}

function shouldMaintainRegistration(){
  return Boolean(sipUA && !manualShutdown && getUserPresence() !== 'Offline' && navigator.onLine);
}

function transportConnected(){
  try { return Boolean(sipUA?.isConnected?.()); } catch (_error) { return false; }
}

function registerWhenConnected(){
  if (!shouldMaintainRegistration() || registered || registrationInFlight || !started || !transportConnected()) return false;
  try {
    registrationInFlight = true;
    registrationStartedAt = Date.now();
    sipUA.register();
    setSipStatus('Registering', 'is-offline');
    return true;
  } catch (error) {
    registrationInFlight = false;
    registrationStartedAt = 0;
    lastRegistrationFailure = error?.message || 'Registration retry failed';
    scheduleRegistrationRetry();
    return false;
  }
}

function scheduleRegistrationRetry(){
  if (!shouldMaintainRegistration() || registered || registrationInFlight || registrationRetryTimer) return false;
  const delay = retryDelay(registrationRetryAttempt, sipConfig?.reconnectMinSeconds, sipConfig?.reconnectMaxSeconds);
  registrationRetryAttempt += 1;
  recordConnectionEvent('registration-retry', `${registrationRetryAttempt}:${delay}`);
  setSipStatus('Reconnecting', 'is-offline');
  registrationRetryTimer = setTimeout(() => {
    registrationRetryTimer = null;
    if (transportConnected()) registerWhenConnected();
    else recoverSipConnection();
  }, delay);
  return true;
}

function scheduleTransportWatchdog(){
  if (!shouldMaintainRegistration() || transportWatchdogTimer) return;
  const delay = (Math.max(5, Number(sipConfig?.reconnectMaxSeconds) || 30) + 5) * 1000;
  transportWatchdogTimer = setTimeout(() => {
    transportWatchdogTimer = null;
    if (!shouldMaintainRegistration() || transportConnected()) return;
    try {
      sipUA.stop();
      started = false;
      sipUA.start();
      started = true;
      recordConnectionEvent('transport-restart');
    } catch (error) {
      lastRegistrationFailure = error?.message || 'Transport restart failed';
      scheduleTransportWatchdog();
    }
  }, delay);
}

function sendTransportKeepalive(){
  if (!shouldMaintainRegistration() || !transportConnected()) return false;
  try {
    return sipUA?._transport?.send?.('\r\n\r\n') !== false;
  } catch (error) {
    lastRegistrationFailure = error?.message || 'Keepalive failed';
    return false;
  }
}


function getSipDomain(){
  const sipUri = sipConfig?.sipUri || '';
  const match = sipUri.match(/^sip:[^@]+@([^;>]+)/i);
  return match?.[1] || '';
}

function normalizeSipTarget(number){
  const cleanNumber = String(number || '').trim().replace(/\s+/g, '');
  const domain = getSipDomain();

  if (!cleanNumber) return '';
  if (cleanNumber.startsWith('sip:')) return cleanNumber;
  if (!domain) return '';

  return `sip:${cleanNumber}@${domain}`;
}

function getMediaConstraints(){
  const { inputDeviceId } = getSelectedAudioDevices();

  return {
    audio: inputDeviceId
      ? { deviceId: { exact: inputDeviceId } }
      : true,
    video: false
  };
}

function getSessionOptions(){
  return {
    mediaConstraints: getMediaConstraints(),
    pcConfig: {
      iceServers: Array.isArray(sipConfig?.iceServers) ? sipConfig.iceServers : []
    }
  };
}

export async function ensureMicrophonePermission(){
  return requestMicrophonePermission();
}

function blockSipForMicrophonePermission(){
  registered = false;
  started = false;
  registrationInFlight = false;
  registrationStartedAt = 0;
  setConnectionInfoText('Microphone permission required');
  setSipStatus('Failed', 'is-failed');
  showError('Microphone permission is required for SIP calls');
  eventHandlers.onMicrophoneDenied?.();
}

function playRemoteAudio(remoteAudio){
  remoteAudio.muted = false;
  remoteAudio.volume = 1.0;
  console.log('Remote audio srcObject', remoteAudio.srcObject);
  remoteAudio.play().catch((err) => {
    console.warn('Remote audio autoplay blocked:', err);
  });
}

export function attachRemoteAudio(session) {
  const remoteAudio = document.getElementById("remoteAudio");
  if (!remoteAudio) {
    console.error("remoteAudio element not found");
    return null;
  }

  currentAudioSession = session || null;

  if (!session?.connection) return remoteAudio;

  const pc = session.connection;
  const remoteStream = new MediaStream();

  console.log('Receivers', pc.getReceivers());

  pc.getReceivers().forEach(receiver => {
    if (receiver.track && receiver.track.kind === "audio") {
      remoteStream.addTrack(receiver.track);
    }
  });

  remoteAudio.srcObject = remoteStream;
  applyAudioDevicesToMedia();
  playRemoteAudio(remoteAudio);
  return remoteAudio;
}

function attachRemoteTrackHandler(session, peerConnection = session?.connection){
  if (!peerConnection || peerConnection.remoteAudioTrackHandlerAttached) return;

  peerConnection.remoteAudioTrackHandlerAttached = true;
  peerConnection.addEventListener('track', (event) => {
    console.log('Remote track received', event);

    if (session !== currentAudioSession) return;

    const remoteAudio = document.getElementById('remoteAudio');
    if (remoteAudio && event.streams && event.streams[0]) {
      remoteAudio.srcObject = event.streams[0];
      applyAudioDevicesToMedia();
      playRemoteAudio(remoteAudio);
      return;
    }

    attachRemoteAudio(session);
  });
}

function prepareSessionAudio(session){
  if (!session || session.remoteAudioPrepared) return;

  session.remoteAudioPrepared = true;
  attachRemoteTrackHandler(session);

  session.on('peerconnection', (event) => {
    attachRemoteTrackHandler(session, event.peerconnection);
  });

}

function sessionAudioTracks(session){
  const receivers = session?.connection?.getReceivers?.() || [];
  return receivers
    .map((receiver) => receiver.track)
    .filter((track) => track?.kind === 'audio');
}

function clearRemoteAudio(session = null){
  const remoteAudio = getElement('remoteAudio');
  if (!remoteAudio) return;

  if (session && session !== currentAudioSession) {
    const currentTracks = remoteAudio.srcObject?.getAudioTracks?.() || [];
    const endedTracks = sessionAudioTracks(session);
    const isPlayingEndedSession = currentTracks.length > 0
      && endedTracks.length > 0
      && currentTracks.every((track) => endedTracks.includes(track));

    if (!isPlayingEndedSession) return;
  }

  remoteAudio.pause?.();
  remoteAudio.srcObject = null;
  if (!session || session === currentAudioSession) currentAudioSession = null;
}

function getCaller(session){
  const remoteIdentity = session?.remote_identity;
  return remoteIdentity?.uri?.user || remoteIdentity?.display_name || 'Unknown caller';
}

function getHandlerName(eventName){
  return {
    accepted: 'onCallAccepted',
    confirmed: 'onCallAccepted',
    ended: 'onCallEnded',
    bye: 'onCallEnded',
    failed: 'onCallFailed',
    rejected: 'onCallFailed',
    canceled: 'onCallFailed',
    progress: 'onCallProgress'
  }[eventName];
}

function addSessionEvents(session, handlers = {}){
  if (!session) return;

  session.on('muted', (event) => {
    handlers.muted?.(event, session);
  });

  session.on('unmuted', (event) => {
    handlers.unmuted?.(event, session);
  });

  session.on('hold', (event) => {
    handlers.hold?.(event, session);
  });

  session.on('unhold', (event) => {
    handlers.unhold?.(event, session);
  });

  sessionEvents.forEach((eventName) => {
    session.on(eventName, (event) => {
      handlers[eventName]?.(event, session);
      const handlerName = getHandlerName(eventName);
      if (handlerName) handlers[handlerName]?.(event, session);

      if (['ended', 'failed', 'bye', 'rejected', 'canceled'].includes(eventName)) {
        clearRemoteAudio(session);
      }
    });
  });
}

function handleNewRTCSession(event){
  if (event.originator !== 'remote') return;

  const session = event.session;
  const presence = getUserPresence();

  if (presence === 'DND') {
    showWarning('Incoming call rejected: DND');
    session.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
    return;
  }
  prepareSessionAudio(session);
  addSessionEvents(session, eventHandlers);

  const caller = getCaller(session);
  eventHandlers.onIncomingCall?.(caller, session);
}

function logRegistrationFailure(event){
  console.error('SIP registration failed', {
    cause: event?.cause,
    response: event?.response,
    status_code: event?.response?.status_code,
    reason_phrase: event?.response?.reason_phrase,
    event
  });
}

export async function initSipClient(config, handlers = {}){
  if (sipUA) stopSipClient();
  sipConfig = config;
  eventHandlers = handlers;
  registered = false;
  started = false;
  manualShutdown = getUserPresence() === 'Offline';
  registrationRetryAttempt = 0;
  lastRegistrationFailure = '';
  registrationInFlight = false;
  connectionEvents = [];

  const browserCapabilities = runBrowserChecks();
  if (!browserCapabilities.canRegisterSip) {
    setConnectionInfo(!browserCapabilities.secureContext ? 'HTTPS required' : 'WebRTC unsupported');
    setSipStatus('Failed', 'is-failed');
    return null;
  }

  if (!window.JsSIP) {
    setConnectionInfoText('JsSIP Missing');
    setSipStatus('Failed', 'is-failed');
    return null;
  }

  const microphonePermission = await ensureMicrophonePermission();

  if (!microphonePermission.granted) {
    blockSipForMicrophonePermission();
    return null;
  }

  const socket = new window.JsSIP.WebSocketInterface(config.websocketUrl);

  sipUA = new window.JsSIP.UA({
    sockets: [socket],
    uri: config.sipUri,
    password: config.password,
    display_name: config.displayName,
    register: false,
    session_timers: config.sessionTimers !== false,
    register_expires: Math.max(120, Number(config.registerExpires) || 600),
    connection_recovery_min_interval: Number(config.reconnectMinSeconds) || 2,
    connection_recovery_max_interval: Number(config.reconnectMaxSeconds) || 30
  });

  sipUA.on('connecting', () => {
    recordConnectionEvent('transport-connecting');
    setConnectionInfo('Connecting');
    setSipStatus('Registering', 'is-offline');
  });

  sipUA.on('connected', () => {
    recordConnectionEvent('transport-connected');
    clearRecoveryTimer('transport');
    setConnectionInfo('Connected');
    if (!registered) window.setTimeout(registerWhenConnected, 250);
  });

  sipUA.on('disconnected', () => {
    recordConnectionEvent('transport-disconnected');
    setConnectionInfo('Disconnected');
    registered = false;
    registrationInFlight = false;
    registrationStartedAt = 0;
    setSipStatus(navigator.onLine ? 'Reconnecting' : 'Network offline', 'is-offline');
    scheduleTransportWatchdog();
  });

  sipUA.on('registered', () => {
    if (!shouldMaintainRegistration()) {
      registrationInFlight = false;
      registrationStartedAt = 0;
      sipUA.unregister();
      return;
    }
    recordConnectionEvent('registered');
    registered = true;
    registrationInFlight = false;
    registrationStartedAt = 0;
    registrationRetryAttempt = 0;
    lastRegistrationFailure = '';
    clearRecoveryTimer('registration');
    clearRecoveryTimer('transport');
    console.log("SIP registered", registered);
    setConnectionInfo('Registered');
    setSipStatus('Registered', 'is-online');
    showSuccess('SIP registered');
  });

  sipUA.on('unregistered', () => {
    recordConnectionEvent('unregistered');
    registered = false;
    registrationInFlight = false;
    registrationStartedAt = 0;
    if (shouldMaintainRegistration()) {
      setConnectionInfo('Registration lost');
      scheduleRegistrationRetry();
    } else {
      setOffline();
    }
  });

  sipUA.on('registrationFailed', (event) => {
    registered = false;
    registrationInFlight = false;
    registrationStartedAt = 0;
    console.log("SIP registered", registered);
    lastRegistrationFailure = recoveryStatus(event) || 'Registration failed';
    recordConnectionEvent('registration-failed', lastRegistrationFailure);
    if (registrationFailureIsPermanent(event)) {
      clearRecoveryTimer('registration');
      setConnectionInfo('Authentication failed');
      setSipStatus('Failed', 'is-failed');
      showError(`SIP registration failed: ${lastRegistrationFailure}`);
    } else {
      setConnectionInfo('Retry scheduled');
      scheduleRegistrationRetry();
    }
    logRegistrationFailure(event);
  });

  sipUA.on('newRTCSession', handleNewRTCSession);
  sipUA.on('newMessage', (event) => {
    if (event.originator !== 'remote') return;
    window.dispatchEvent(new CustomEvent('sip:message', {
      detail: {
        from: event.request?.from?.uri?.user || 'Unknown',
        body: String(event.request?.body || ''),
        receivedAt: new Date().toISOString()
      }
    }));
  });

  if (getUserPresence() !== 'Offline') {
    sipUA.start();
    started = true;
  } else {
    setOffline();
  }

  bindRecoveryEvents();

  return sipUA;
}

function recoverSipConnection(){
  if (!sipUA || getUserPresence() === 'Offline' || !navigator.onLine) return false;
  setConnectionInfo('Reconnecting');
  setSipStatus('Reconnecting', 'is-offline');
  try {
    if (!started) {
      sipUA.start();
      started = true;
    } else if (transportConnected() && !registered) {
      registerWhenConnected();
    } else if (!transportConnected()) {
      scheduleTransportWatchdog();
    }
    return true;
  } catch (error) {
    console.warn('Unable to recover SIP connection', error);
    return false;
  }
}

function bindRecoveryEvents(){
  if (recoveryBound) return;
  recoveryBound = true;
  window.addEventListener('online', recoverSipConnection);
  window.addEventListener('offline', () => {
    registered = false;
    registrationInFlight = false;
    registrationStartedAt = 0;
    setConnectionInfo('Network offline');
    setSipStatus('Network offline', 'is-offline');
  });
  window.setInterval(() => {
    const now = Date.now();
    const resumed = now - lastWakeCheck > 45000;
    lastWakeCheck = now;
    if (resumed) recoverSipConnection();
  }, 15000);
  window.setInterval(() => {
    if (!shouldMaintainRegistration()) return;
    if (!transportConnected()) {
      scheduleTransportWatchdog();
      return;
    }
    sendTransportKeepalive();
    if (registrationInFlight && Date.now() - registrationStartedAt > 45000) {
      registrationInFlight = false;
      registrationStartedAt = 0;
      lastRegistrationFailure = 'Registration response timeout';
      recordConnectionEvent('registration-timeout', lastRegistrationFailure);
    }
    if (!registered) scheduleRegistrationRetry();
  }, 25000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) recoverSipConnection();
  });
}

export async function registerSip(){
  const browserCapabilities = runBrowserChecks();
  if (!browserCapabilities.canRegisterSip) {
    setConnectionInfo(!browserCapabilities.secureContext ? 'HTTPS required' : 'WebRTC unsupported');
    setSipStatus('Failed', 'is-failed');
    return false;
  }

  const microphonePermission = await ensureMicrophonePermission();
  if (!microphonePermission.granted) {
    blockSipForMicrophonePermission();
    return false;
  }

  if (!sipUA) return false;

  manualShutdown = false;
  clearRecoveryTimer('registration');

  if (registered) return true;

  setSipStatus('Registering', 'is-offline');

  if (!started) {
    sipUA.start();
    started = true;
  }

  return registerWhenConnected() || !transportConnected();
}

export async function retrySipRegistration(config = sipConfig, handlers = eventHandlers){
  if (!config) return null;
  return initSipClient(config, handlers);
}

export function unregisterSip(){
  if (!sipUA) return false;

  manualShutdown = true;
  registrationInFlight = false;
  registrationStartedAt = 0;
  clearRecoveryTimer('registration');
  clearRecoveryTimer('transport');

  if (started && registered) {
    sipUA.unregister();
  }

  registered = false;
  setOffline();
  return true;
}

export function stopSipClient(){
  if (!sipUA) return false;

  manualShutdown = true;
  registrationInFlight = false;
  registrationStartedAt = 0;
  clearRecoveryTimer('registration');
  clearRecoveryTimer('transport');
  sipUA.stop();
  sipUA = null;
  registered = false;
  started = false;
  setOffline();
  return true;
}

function describeReadyState(readyState){
  return {
    0: 'Connecting',
    1: 'Open',
    2: 'Closing',
    3: 'Closed'
  }[readyState] || (readyState == null ? 'Unavailable' : String(readyState));
}

function getWebSocketState(){
  const socket = sipUA?._transport?.socket?._ws || sipUA?._transport?.socket?.socket || sipUA?._transport?.socket;
  return describeReadyState(socket?.readyState);
}

export function getSipDiagnostics(){
  return {
    registrationState: registered ? 'Registered' : started ? 'Unregistered' : 'Offline',
    websocketState: getWebSocketState(),
    recoveryAttempt: registrationRetryAttempt,
    lastRegistrationFailure,
    connectionEvents: [...connectionEvents]
  };
}

export function getSipUA(){
  return sipUA;
}

export function isSipRegistered(){
  return registered;
}

export function sendSipMessage(targetNumber, body){
  if (!sipUA || !registered || typeof sipUA.sendMessage !== 'function') return false;
  const target = normalizeSipTarget(targetNumber);
  const message = String(body || '').trim();
  if (!target || !message) return false;
  sipUA.sendMessage(target, message, {
    contentType: 'text/plain',
    eventHandlers: {
      succeeded: () => showSuccess('SIP message sent'),
      failed: () => showError('SIP message failed')
    }
  });
  return true;
}


export function createOutgoingSession(number, eventHandlers = {}){
  if (!sipUA || !registered) {
    console.error('Cannot make SIP call: JsSIP is not registered');
    setSipStatus('Offline', 'is-offline');
    return null;
  }

  const target = normalizeSipTarget(number);
  if (!target) {
    console.error('Cannot make SIP call: invalid target', { number, sipUri: sipConfig?.sipUri });
    return null;
  }

  const session = sipUA.call(target, getSessionOptions());
  prepareSessionAudio(session);
  addSessionEvents(session, eventHandlers);

  return session;
}

export function answerSession(session){
  if (!session) return false;

  session.answer(getSessionOptions());
  prepareSessionAudio(session);
  return true;
}

export function hangupSession(session){
  if (!session) return false;

  session.terminate();
  return true;
}

export function holdSession(session){
  if (!session) return false;

  session.hold();
  return true;
}

export function unholdSession(session){
  if (!session) return false;

  session.unhold();
  return true;
}

export function muteSession(session){
  if (!session) return false;

  session.mute({ audio: true });
  return true;
}

export function unmuteSession(session){
  if (!session) return false;

  session.unmute({ audio: true });
  return true;
}

export function sendDTMF(session, tone){
  if (!session || !tone) return false;

  session.sendDTMF(tone);
  return true;
}

export function blindTransferSession(session, targetNumber){
  if (!session) {
    console.error('No active session to transfer');
    showError('Transfer failed');
    return false;
  }

  if (!String(targetNumber || '').trim()) {
    console.error('Blind transfer failed: transfer target is empty');
    showError('Transfer failed');
    return false;
  }

  const target = normalizeSipTarget(targetNumber);
  if (!target) {
    console.error('Blind transfer failed: invalid target or SIP domain unavailable', {
      targetNumber,
      sipUri: sipConfig?.sipUri
    });
    showError('Transfer failed');
    return false;
  }

  try {
    console.log('Starting blind transfer', { target });
    const subscriber = session.refer(target, {
      eventHandlers: {
        requestSucceeded: (event) => console.log('Blind transfer REFER request succeeded', event),
        requestFailed: (event) => {
          console.error('Blind transfer REFER request failed', event);
          showError('Transfer failed');
        },
        accepted: (event) => console.log('Blind transfer accepted', event),
        failed: (event) => {
          console.error('Blind transfer failed', event);
          showError('Transfer failed');
        }
      }
    });
    showSuccess('Transfer sent');
    return Boolean(subscriber);
  } catch (error) {
    console.error('Blind transfer failed:', error);
    showError('Transfer failed');
    return false;
  }
}

export function attendedTransferSession(session, replacementSession, targetNumber){
  if (!session || !replacementSession) {
    showError('Attended transfer is not ready');
    return false;
  }

  const target = normalizeSipTarget(targetNumber);
  if (!target) {
    showError('Transfer failed');
    return false;
  }

  try {
    const subscriber = session.refer(target, {
      replaces: replacementSession,
      eventHandlers: {
        requestFailed: () => showError('Attended transfer request failed'),
        accepted: () => showSuccess('Attended transfer accepted'),
        failed: () => showError('Attended transfer failed')
      }
    });
    return Boolean(subscriber);
  } catch (error) {
    console.error('Attended transfer failed', error);
    showError('Attended transfer failed');
    return false;
  }
}
