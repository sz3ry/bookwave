import storage from './storage';

declare global {
  interface Window {
    electronApi?: any;
  }
}

export class ApiError extends Error {
  response: { status: number; data: unknown };

  constructor(message: string, response: { status: number; data: unknown }) {
    super(message);
    this.name = 'ApiError';
    this.response = response;
  }
}

export interface ApiResponse<T = any> {
  data: T;
}

interface RequestConfig {
  headers?: Record<string, string>;
}

type Method = 'get' | 'post' | 'put' | 'delete';

const request = async <T>(
  method: Method,
  url: string,
  data?: unknown,
  config?: RequestConfig,
): Promise<ApiResponse<T>> => {
  const token = await storage.get('token');
  const headers = {
    ...(config?.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const finalConfig = { ...config, headers };
  const hadToken = !!headers.Authorization;
  const notifyUnauthorized = (status: unknown) => {
    if (status === 401 && hadToken && !url.includes('/login')) {
      window.dispatchEvent(new Event('unauthorized'));
    }
  };

  try {
    const result = await window.electronApi[method](`/api${url}`, data ?? null, finalConfig);
    if (result?.__isError) {
      notifyUnauthorized(result.statusCode);
      throw new ApiError(result.error, { status: result.statusCode, data: result.data });
    }
    return result;
  } catch (error: any) {
    // ApiError was already reported above; this covers unexpected IPC errors
    if (!(error instanceof ApiError)) {
      notifyUnauthorized(error?.response?.status ?? error?.status ?? error?.statusCode);
    }
    throw error;
  }
};

const api = {
  get: <T = any>(url: string, config?: RequestConfig) => request<T>('get', url, null, config),
  post: <T = any>(url: string, data?: unknown, config?: RequestConfig) =>
    request<T>('post', url, data, config),
  put: <T = any>(url: string, data?: unknown, config?: RequestConfig) =>
    request<T>('put', url, data, config),
  delete: <T = any>(url: string, config?: RequestConfig) => request<T>('delete', url, null, config),
};

export default api;

export const trackAction = async (message: string, data?: any) => {
  try {
    await api.post('/logs/action', { message, data });
  } catch (e) {
    // Silently ignore tracking errors
    console.error('Failed to track action', e);
  }
};
