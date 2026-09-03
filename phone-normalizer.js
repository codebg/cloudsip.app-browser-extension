const COUNTRY_RULES = {
  AL: { code: '355', removeLeadingZero: true },
  IT: { code: '39', removeLeadingZero: false },
  GB: { code: '44', removeLeadingZero: true },
  DE: { code: '49', removeLeadingZero: true },
  FR: { code: '33', removeLeadingZero: true },
  US: { code: '1', removeLeadingZero: false }
};

export function cleanPhoneNumber(value){
  let number = String(value || '').trim().replace(/^tel:/i, '').split(/[?#;]/)[0];
  number = number.replace(/[^0-9+*#]/g, '').replace(/(?!^)\+/g, '');
  if (number.startsWith('00')) number = `+${number.slice(2)}`;
  return number;
}

export function normalizePhoneNumber(value, country = 'NONE'){
  let number = cleanPhoneNumber(value);
  if (!number || number.startsWith('+') || number.startsWith('*') || number.startsWith('#')) return number;

  const rule = COUNTRY_RULES[String(country || '').toUpperCase()];
  if (!rule) return number;
  if (rule.removeLeadingZero) number = number.replace(/^0+/, '');
  if (rule.code === '1' && number.length === 11 && number.startsWith('1')) return `+${number}`;
  return `+${rule.code}${number}`;
}

export function domainPattern(url){
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS pages are supported');
  return `${parsed.protocol}//${parsed.host}/*`;
}

export function normalizeDomainList(value){
  const items = Array.isArray(value) ? value : String(value || '').split(/[\n,]+/);
  const domains = [];
  for (const item of items) {
    const raw = String(item || '').trim();
    if (!raw) continue;
    try {
      const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
      const pattern = domainPattern(withProtocol);
      if (!domains.includes(pattern)) domains.push(pattern);
    } catch (_error) {}
  }
  return domains;
}

