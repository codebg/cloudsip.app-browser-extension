export function retryDelay(attempt, minimumSeconds = 2, maximumSeconds = 30){
  const minimum = Math.max(1, Number(minimumSeconds) || 2);
  const maximum = Math.max(minimum, Number(maximumSeconds) || 30);
  return Math.min(maximum, minimum * (2 ** Math.max(0, Number(attempt) || 0))) * 1000;
}

export function registrationFailureIsPermanent(event){
  const code = Number(event?.response?.status_code || event?.response?.statusCode || 0);
  const cause = String(event?.cause || '').toLowerCase();
  return [401, 403, 404].includes(code) || cause.includes('authentication');
}

export function recoveryStatus(event){
  const code = Number(event?.response?.status_code || event?.response?.statusCode || 0);
  const reason = event?.response?.reason_phrase || event?.response?.reasonPhrase || event?.cause || '';
  return [code, reason].filter(Boolean).join(' ');
}
