(() => {
  if (globalThis.__cloudsipContentScriptLoaded || window.top !== window) return;
  globalThis.__cloudsipContentScriptLoaded = true;
  const PHONE_REGEX = /(?:\+?\d[\d\s().-]{6,}\d)/g;
  const MAX_REPLACEMENTS = 100;
  const BLOCKED_SELECTOR = 'script, style, input, textarea, select, button, a, code, pre, [contenteditable="true"], .cloudsip-phone, .cloudsip-call-btn';
  const defaults = { clickToCallEnabled: false, clickToCallAutoDial: false, crmIntegrationEnabled: false, crmAllowedOrigins: [] };
  let settings = { ...defaults };
  let replacementCount = 0;
  let observer = null;
  let scanTimer = null;
  let isScanning = false;

  function normalizePhone(raw) {
    return String(raw || '').trim().replace(/^tel:/i, '').split(/[?#;]/)[0].replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  }

  function isValidPhone(value) {
    const digits = normalizePhone(value).replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 18;
  }

  function isLikelyDate(value) {
    return /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/.test(String(value).trim()) || /^\d{1,2}\s*[.-]\s*\d{1,2}\s*[.-]\s*\d{2,4}$/.test(String(value).trim());
  }

  function sendCall(number, source = 'browser', autoStart = settings.clickToCallAutoDial) {
    return chrome.runtime.sendMessage({ type: source === 'crm' ? 'CLOUDSIP_CRM_CALL' : 'CLOUDSIP_CLICK_TO_CALL', number, source, autoStart });
  }

  function createCallButton(number) {
    const button = document.createElement('button');
    button.className = 'cloudsip-call-btn';
    button.type = 'button';
    button.title = 'Call with CloudSIP';
    button.textContent = '☎';
    button.dataset.cloudsipProcessed = '1';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      sendCall(number);
    });
    return button;
  }

  function createPhoneWrapper(rawText) {
    const wrapper = document.createElement('span');
    wrapper.className = 'cloudsip-phone';
    wrapper.dataset.cloudsipProcessed = '1';
    wrapper.append(document.createTextNode(rawText), createCallButton(normalizePhone(rawText)));
    return wrapper;
  }

  function scanTelLinks() {
    document.querySelectorAll('a[href^="tel:"]').forEach((link) => {
      if (replacementCount >= MAX_REPLACEMENTS || link.dataset.cloudsipProcessed === '1') return;
      const number = normalizePhone(link.getAttribute('href'));
      if (!isValidPhone(number)) return;
      link.insertAdjacentElement('afterend', createCallButton(number));
      link.dataset.cloudsipProcessed = '1';
      replacementCount += 1;
    });
  }

  function wrapTextNode(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest(BLOCKED_SELECTOR)) return;
    const text = node.nodeValue || '';
    PHONE_REGEX.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let changed = false;
    let match;
    while ((match = PHONE_REGEX.exec(text)) && replacementCount < MAX_REPLACEMENTS) {
      const rawText = match[0];
      const endIndex = match.index + rawText.length;
      const price = /[$£€]\s*$/.test(text.slice(Math.max(0, match.index - 3), match.index));
      if (!isValidPhone(rawText) || isLikelyDate(rawText) || price) continue;
      if (match.index > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      fragment.appendChild(createPhoneWrapper(rawText));
      lastIndex = endIndex;
      replacementCount += 1;
      changed = true;
    }
    PHONE_REGEX.lastIndex = 0;
    if (!changed) return;
    if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    node.replaceWith(fragment);
  }

  function scanPage() {
    if (isScanning || !settings.clickToCallEnabled || !document.body) return;
    isScanning = true;
    try {
      scanTelLinks();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let node;
      while ((node = walker.nextNode()) && nodes.length + replacementCount < MAX_REPLACEMENTS) nodes.push(node);
      nodes.forEach(wrapTextNode);
    } finally {
      isScanning = false;
    }
  }

  function startObserver() {
    if (!document.body || observer || !settings.clickToCallEnabled) return;
    observer = new MutationObserver(() => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(scanPage, 700);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function crmOriginAllowed() {
    return settings.crmAllowedOrigins.some((pattern) => {
      try { return new URL(pattern.replace(/\*$/, '')).origin === location.origin; } catch (_error) { return false; }
    });
  }

  function handleCrmCall(number, autoStart) {
    if (!settings.crmIntegrationEnabled || !crmOriginAllowed() || !isValidPhone(number)) return;
    sendCall(number, 'crm', autoStart === true);
  }

  function parseCloudSipLink(href) {
    if (!/^cloudsip:/i.test(href)) return '';
    const direct = href.replace(/^cloudsip:(?:\/\/call\/?|call\/?)/i, '');
    try { return new URL(href).searchParams.get('number') || direct; } catch (_error) { return direct; }
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href^="cloudsip:"]');
    if (!link || !settings.crmIntegrationEnabled || !crmOriginAllowed()) return;
    const number = parseCloudSipLink(link.href || link.getAttribute('href') || '');
    if (!isValidPhone(number)) return;
    event.preventDefault();
    handleCrmCall(number, link.dataset.cloudsipAutoStart === 'true');
  }, true);

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'CLOUDSIP_CALL') return;
    handleCrmCall(event.data.number, event.data.autoStart);
  });
  window.addEventListener('cloudsip:call', (event) => handleCrmCall(event.detail?.number, event.detail?.autoStart));

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CLOUDSIP_RESCAN_NUMBERS') scanPage();
    if (message.type === 'CLOUDSIP_CALL_STATUS' && settings.crmIntegrationEnabled) {
      const detail = { status: message.status, number: message.number || '' };
      window.dispatchEvent(new CustomEvent('cloudsip:call-status', { detail }));
      window.postMessage({ type: 'CLOUDSIP_CALL_STATUS', ...detail }, location.origin);
    }
  });

  chrome.storage.local.get(defaults, (result) => {
    settings = { ...defaults, ...result };
    if (settings.clickToCallEnabled) {
      scanPage();
      startObserver();
    }
    if (settings.crmIntegrationEnabled && crmOriginAllowed()) {
      window.dispatchEvent(new CustomEvent('cloudsip:ready', { detail: { version: 1 } }));
      window.postMessage({ type: 'CLOUDSIP_READY', version: 1 }, location.origin);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    Object.keys(defaults).forEach((key) => { if (changes[key]) settings[key] = changes[key].newValue; });
    if (settings.clickToCallEnabled) {
      scanPage();
      startObserver();
    } else {
      observer?.disconnect();
      observer = null;
      clearTimeout(scanTimer);
    }
  });
})();
