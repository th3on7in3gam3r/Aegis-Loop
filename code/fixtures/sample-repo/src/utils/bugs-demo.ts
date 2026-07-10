/** Intentional bug patterns for Aegis Loop / code demo scans */

export function parseUserId(raw: string) {
  if (raw == '0') return null;
  return parseInt(raw);
}

export async function syncUsers(ids: string[]) {
  ids.forEach(async (id) => {
    await fetch(`/api/users/${id}`);
  });
}

export function loadConfig() {
  try {
    return JSON.parse('{}');
  } catch (e) {}
}

export function failFast() {
  throw 'config missing';
}
