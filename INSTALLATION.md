# CloudSIP Extension Installation Guide

This guide explains how to install, configure, update, and troubleshoot the CloudSIP browser extension from the unpacked `extension/` folder.

## 1. Prerequisites

Before installing, make sure you have:

- Google Chrome, Microsoft Edge, Brave, or another Chromium browser with Manifest V3 support.
- Access to this repository on the machine where the browser is running.
- SIP credentials for a WebRTC-capable extension.
- A SIP WebSocket URL, usually using `wss://` for production.
- Permission to use the microphone on the workstation.

Your SIP server must support WebRTC media and SIP over WebSocket. For production deployments, use TLS/WSS and a valid certificate.

## 2. Install in Google Chrome

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked**.
5. Select the repository's `extension/` folder.
6. Confirm that **CloudSIP** appears in the extensions list.
7. Pin CloudSIP to the toolbar if you want quick access.
8. Click the CloudSIP icon to open the phone side panel.

## 3. Install in Microsoft Edge

1. Open Edge.
2. Go to `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository's `extension/` folder.
6. Confirm that **CloudSIP** appears in the extensions list.
7. Click the CloudSIP icon to open the phone side panel.

## 4. First-time configuration

1. Open CloudSIP from the extension icon.
2. Click **Settings**.
3. In **Audio Devices**, click **Allow Microphone** if prompted.
4. In **SIP Account**, enter:
   - **Extension**: the user/extension number.
   - **SIP Domain**: the SIP domain or PBX host.
   - **WebSocket URL**: the SIP WebSocket endpoint, for example `wss://pbx.example.com:8089/ws`.
   - **SIP URI**: the SIP address, for example `sip:1001@pbx.example.com`.
   - **Display Name**: the caller display name shown by the phone.
   - **Password**: the SIP extension password.
5. Click **Save Settings**.
6. Use **Reconnect SIP** in **WebRTC Diagnostics** if the phone does not register automatically.
7. Confirm that the header status changes from **Offline** to a registered/online state.

For networks that require NAT traversal, add one or more STUN or TURN URLs in SIP Settings. Add one URL per line. SIP session timers are enabled by default, and CloudSIP retries registration after network restoration or browser wake.

Quick Setup uses port `8089` and path `/ws` unless the PBX host includes a port. Use Advanced Setup for custom SIP, WSS, STUN, TURN, and session timer values. Profiles are stored locally, configuration files exclude the password by default, and disabling Remember password keeps the credential only for the current browser session.

## 5. Enable click-to-call on websites

CloudSIP can add call buttons beside phone numbers on webpages.

1. Open the website where click-to-call is needed.
2. Open CloudSIP **Settings** and expand **Browser integration**.
3. Click **Enable current site** and approve the exact domain permission.
4. Keep **Whitelist** as the default policy, or select the blacklist preference for previously granted sites.
5. Optionally select a country for local-number normalization and enable automatic dialing.
6. Refresh the website, then click the CloudSIP button beside a detected number.
7. If the page loads numbers dynamically, click **Rescan**.

Click-to-call, automatic dialing, country prefixes, and CRM integration are disabled or neutral by default. **Remove current site** revokes the domain permission and adds it to the blocked list.

## 6. CRM integration API

Enable **CRM integration API**, add the CRM origin, and grant that website access with **Enable current site**. The CRM page can request a call using any of these local browser mechanisms:

```js
window.dispatchEvent(new CustomEvent('cloudsip:call', {
  detail: { number: '+355XXXXXXXXX', autoStart: false }
}));

window.postMessage({
  type: 'CLOUDSIP_CALL',
  number: '+355XXXXXXXXX',
  autoStart: false
}, window.location.origin);
```

Links can use `cloudsip://call?number=%2B355XXXXXXXXX`. The page receives `cloudsip:ready` and `cloudsip:call-status` events, plus equivalent `CLOUDSIP_READY` and `CLOUDSIP_CALL_STATUS` messages. All communication stays in the browser; CloudSIP does not require a backend.

The extension intentionally avoids scanning forms, buttons, links, code blocks, scripts, and some date/price patterns to reduce false positives.

## 7. Updating the unpacked extension

When files in `extension/` change:

1. Open `chrome://extensions` or `edge://extensions`.
2. Find **CloudSIP**.
3. Click the reload icon for the extension.
4. Close and reopen the CloudSIP side panel.
5. Refresh any webpages where click-to-call should be active.

If behavior looks stale, fully remove the extension and load the unpacked folder again.

## 8. Troubleshooting

### Microphone permission is blocked

- Open browser site/extension permission settings and allow microphone access for CloudSIP.
- Reopen the CloudSIP side panel.
- In **WebRTC Diagnostics**, click **Allow Microphone / Retry SIP**.

### SIP does not register

- Verify the SIP domain, SIP URI, extension, password, and WebSocket URL.
- Confirm the WebSocket URL uses `wss://` in production.
- Check that the PBX supports WebRTC, DTLS-SRTP, ICE, and SIP over WebSocket.
- Use **WebRTC Diagnostics** to inspect SIP registration and WebSocket state.

### No audio or wrong audio device

- Check operating-system input/output device permissions.
- Use **Refresh devices** in **Audio Devices**.
- Select the intended microphone and speaker.
- Run **Test microphone** and **Test speaker** in diagnostics.
- Note that speaker selection depends on browser support for audio output device APIs.

### Click-to-call buttons do not appear

- Confirm **Website click-to-call** is enabled.
- Confirm the current site appears in **Allowed domains** and its browser permission is granted.
- Refresh the webpage.
- Click **Rescan current page** from Settings.
- Confirm the page is not a restricted browser page such as `chrome://extensions`, where content scripts cannot run.
- Check that the number has at least seven digits and is not inside an ignored element such as an input, button, code block, or existing link.

## 9. Uninstall

1. Open `chrome://extensions` or `edge://extensions`.
2. Find **CloudSIP**.
3. Click **Remove**.
4. Confirm removal.

Removing the extension removes browser-extension storage associated with the installed extension ID. Download any recordings you need before uninstalling.
