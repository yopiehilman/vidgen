import { auth } from '../firebase';

interface PostJsonOptions {
  auth?: boolean;
  headers?: Record<string, string>;
}

export async function postJson<TResponse>(
  url: string,
  payload: unknown,
  options: PostJsonOptions = {},
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
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
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
