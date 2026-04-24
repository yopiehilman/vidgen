interface PostJsonOptions {
  auth?: boolean;
  headers?: Record<string, string>;
}

interface JsonRequestOptions extends PostJsonOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  payload?: unknown;
}

export interface StoredSession {
  token: string;
  username: string;
  expiresAt?: string;
}

export function getStoredSession(): StoredSession | null {
  const raw = localStorage.getItem('vg_session');
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    localStorage.removeItem('vg_session');
    return null;
  }
}

export function setStoredSession(session: StoredSession) {
  localStorage.setItem('vg_session', JSON.stringify(session));
}

export function clearStoredSession() {
  localStorage.removeItem('vg_session');
}

async function requestJson<TResponse>(
  url: string,
  options: JsonRequestOptions = {},
): Promise<TResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (options.auth) {
    const session = getStoredSession();
    if (!session?.token) {
      throw new Error('Anda harus login terlebih dulu.');
    }

    headers.Authorization = `Bearer ${session.token}`;
  }

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    ...(options.method === 'POST' ? { body: JSON.stringify(options.payload) } : {}),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = (() => {
      if (data && typeof data.error === 'string' && typeof data.details === 'string' && data.details) {
        return `${data.error}: ${data.details}`;
      }
      if (data && typeof data.error === 'string') {
        return data.error;
      }
      return `Request ke ${url} gagal dengan status ${response.status}.`;
    })();
    throw new Error(message);
  }

  return data as TResponse;
}

export async function postJson<TResponse>(
  url: string,
  payload: unknown,
  options: PostJsonOptions = {},
): Promise<TResponse> {
  return requestJson<TResponse>(url, {
    ...options,
    method: 'POST',
    payload,
  });
}

export async function getJson<TResponse>(
  url: string,
  options: PostJsonOptions = {},
): Promise<TResponse> {
  return requestJson<TResponse>(url, {
    ...options,
    method: 'GET',
  });
}

export async function deleteJson<TResponse>(
  url: string,
  options: PostJsonOptions = {},
): Promise<TResponse> {
  return requestJson<TResponse>(url, {
    ...options,
    method: 'DELETE',
  });
}
