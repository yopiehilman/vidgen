export async function postJson<TResponse>(url: string, payload: unknown): Promise<TResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data && typeof data.error === 'string'
        ? data.error
        : `Request ke ${url} gagal dengan status ${response.status}.`;
    throw new Error(message);
  }

  return data as TResponse;
}
