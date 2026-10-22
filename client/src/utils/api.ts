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
  const finalConfig = { ...config, headers: { ...(config?.headers || {}) } };

  const result = await window.electronApi[method](`/api${url}`, data ?? null, finalConfig);
  if (result?.__isError) {
    throw new ApiError(result.error, { status: result.statusCode, data: result.data });
  }
  return result;
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
