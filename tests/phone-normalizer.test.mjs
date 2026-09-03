import assert from 'node:assert/strict';
import { cleanPhoneNumber, domainPattern, normalizeDomainList, normalizePhoneNumber } from '../phone-normalizer.js';

assert.equal(cleanPhoneNumber('tel:+355 (69) 123-4567'), '+355691234567');
assert.equal(cleanPhoneNumber('00355 69 123 4567'), '+355691234567');
assert.equal(normalizePhoneNumber('069 123 4567'), '0691234567');
assert.equal(normalizePhoneNumber('069 123 4567', 'AL'), '+355691234567');
assert.equal(normalizePhoneNumber('06 1234 5678', 'IT'), '+390612345678');
assert.equal(normalizePhoneNumber('+44 20 1234 5678', 'AL'), '+442012345678');
assert.equal(domainPattern('https://crm.example.com/customers/4'), 'https://crm.example.com/*');
assert.deepEqual(normalizeDomainList('crm.example.com\nhttps://pbx.example.com/path'), ['https://crm.example.com/*', 'https://pbx.example.com/*']);

console.log('phone-normalizer tests passed');
