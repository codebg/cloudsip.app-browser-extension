import assert from 'node:assert/strict';
import { registrationFailureIsPermanent, recoveryStatus, retryDelay } from '../assets/js/sip-recovery-policy.js';

assert.equal(retryDelay(0, 2, 30), 2000);
assert.equal(retryDelay(3, 2, 30), 16000);
assert.equal(retryDelay(8, 2, 30), 30000);
assert.equal(registrationFailureIsPermanent({ response: { status_code: 403 } }), true);
assert.equal(registrationFailureIsPermanent({ response: { status_code: 503 } }), false);
assert.equal(registrationFailureIsPermanent({ cause: 'Authentication Error' }), true);
assert.equal(recoveryStatus({ response: { status_code: 503, reason_phrase: 'Service Unavailable' } }), '503 Service Unavailable');

console.log('sip recovery policy tests passed');
