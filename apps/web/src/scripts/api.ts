import { showToast } from './ui';

const SESSION_EXPIRED_REDIRECT_MS = 2000;

function csrfToken(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
}

let sessionExpiredHandled = false;

function onSessionExpired(): void {
  showToast('Tu sesión ha caducado. Te llevo a entrar de nuevo con Discord…', 'error');
  setTimeout(() => { location.href = '/auth/login'; }, SESSION_EXPIRED_REDIRECT_MS);
}

let passiveDepth = 0;

export async function withPassive<T>(fn: () => Promise<T>): Promise<T> {
  passiveDepth++;
  try {
    return await fn();
  } finally {
    passiveDepth--;
  }
}

export async function logout(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const { method = 'GET', body } = options;
  const isFormData = body instanceof FormData;

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(method !== 'GET' ? { 'x-csrf-token': csrfToken() } : {}),
        ...(body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(passiveDepth > 0 ? { 'X-Passive-Refresh': '1' } : {}),
      },
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No se pudo contactar con el servidor. Comprueba tu conexión y vuelve a intentarlo.');
  }

  const contentType = res.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await res.json().catch(() => null) : null;

  if (res.status === 401 && !sessionExpiredHandled) {
    sessionExpiredHandled = true;
    onSessionExpired();
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      res.status === 401
        ? 'Tu sesión ha caducado. Vuelve a entrar con Discord.'
        : data?.error ?? `Error ${res.status} llamando a ${path}.`
    );
  }
  return data as T;
}
