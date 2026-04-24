import { auth } from '../firebase';

interface PostJsonOptions {
  auth?: boolean;
  headers?: Record<string, string>;
}

interface JsonRequestOptions extends PostJsonOptions {
  method?: 'GET' | 'POST';
  payload?: unknown;
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
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Anda harus login terlebih dulu.');
    }

    headers.Authorization = `Bearer ${await user.getIdToken()}`;
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
