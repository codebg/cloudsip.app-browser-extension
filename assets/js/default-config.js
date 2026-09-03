export const defaultConfig = {
  companyWebsite: 'www.connxta.com',
  sip: {
    extension: 'DEMO',
    sipDomain: 'sip.domain.com',
    websocketUrl: 'wss://sip.domain.com:8089/ws',
    sipUri: 'sip:DEMO@sip.domain.com',
    displayName: 'DEMO',
    password: '',
    iceServers: [],
    sessionTimers: true,
    reconnectMinSeconds: 2,
    reconnectMaxSeconds: 30
  },
  settings: {
    autoAnswer: false,
    autoHoldOnSwitch: true,
    autoRecordCalls: false,
    clickToCallEnabled: false,
    clickToCallAutoDial: false,
    theme: 'light'
  }
};
