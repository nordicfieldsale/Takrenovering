const TOKEN_KEY = 'villa.token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* privat läge i Safari – appen fungerar ändå under sessionen */
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

/**
 * Alla anrop går mot samma origin som appen, så ingen adress
 * behöver konfigureras vid driftsättning.
 */
export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Ingen kontakt med servern. Kontrollera uppkopplingen.');
  }

  if (response.status === 401) {
    setToken(null);
    onUnauthorized();
    throw new Error('Sessionen har gått ut. Logga in igen.');
  }

  if (raw) {
    if (!response.ok) throw new Error('Kunde inte hämta filen.');
    return response;
  }

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    throw new Error((data && data.error) || 'Något gick fel. Försök igen.');
  }
  return data;
}
