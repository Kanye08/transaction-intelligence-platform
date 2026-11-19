import type {
  Account,
  Category,
  ClassificationHistoryEntry,
  DashboardSummary,
  LoginResponse,
  ReviewFlag,
  ReviewFlagPage,
  ReviewSummary,
  Transaction,
  TransactionPage,
  User,
} from './types';

const TOKEN_KEY = 'sycamore.token';

/** Carries the API's problem details, so screens show the server's own message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly validationErrors?: string[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private browsing: the session simply does not survive a reload */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

/** Called when the API rejects the token, so the app can return to login. */
let onUnauthorised: () => void = () => undefined;
export function setUnauthorisedHandler(handler: () => void): void {
  onUnauthorised = handler;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check that the API is running.');
  }

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as
    | (Record<string, unknown> & { detail?: string; code?: string; validationErrors?: string[] })
    | null;

  if (!response.ok) {
    if (response.status === 401 && token) {
      tokenStore.clear();
      onUnauthorised();
    }
    throw new ApiError(
      response.status,
      payload?.detail ?? `Request failed with status ${response.status}`,
      payload?.code,
      payload?.validationErrors,
    );
  }

  return payload as T;
}

function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const serialised = search.toString();
  return serialised ? `?${serialised}` : '';
}

export interface TransactionFilters {
  [key: string]: string | number | boolean | undefined | null;
  accountId?: string;
  direction?: string;
  category?: string;
  classificationStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: string;
  amountMax?: string;
  search?: string;
  review?: string;
  limit?: number;
  cursor?: string | null;
  includeTotal?: boolean;
}

export const api = {
  login(email: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  me(): Promise<User> {
    return request<User>('/auth/me');
  },

  logout(): Promise<void> {
    return request<void>('/auth/logout', { method: 'POST' });
  },

  accounts(): Promise<Account[]> {
    return request<Account[]>('/accounts');
  },

  dashboard(params: { dateFrom?: string; dateTo?: string; accountId?: string }): Promise<DashboardSummary> {
    return request<DashboardSummary>(`/dashboard/summary${query(params)}`);
  },

  transactions(filters: TransactionFilters): Promise<TransactionPage> {
    return request<TransactionPage>(`/transactions${query(filters)}`);
  },

  transaction(id: string): Promise<Transaction> {
    return request<Transaction>(`/transactions/${id}`);
  },

  classificationHistory(id: string): Promise<ClassificationHistoryEntry[]> {
    return request<ClassificationHistoryEntry[]>(`/transactions/${id}/classification-history`);
  },

  correctClassification(id: string, category: Category, reason?: string): Promise<unknown> {
    return request(`/transactions/${id}/classification`, {
      method: 'PATCH',
      body: JSON.stringify({ category, reason }),
    });
  },

  reclassify(id: string): Promise<unknown> {
    return request(`/transactions/${id}/reclassify`, { method: 'POST' });
  },

  reviewFlags(params: {
    status?: string;
    rule?: string;
    severity?: string;
    limit?: number;
    offset?: number;
  }): Promise<ReviewFlagPage> {
    return request<ReviewFlagPage>(`/review/flags${query(params)}`);
  },

  reviewSummary(): Promise<ReviewSummary> {
    return request<ReviewSummary>('/review/summary');
  },

  resolveFlag(id: string, action: 'RESOLVE' | 'DISMISS', note?: string): Promise<ReviewFlag> {
    return request<ReviewFlag>(`/review/flags/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action, note }),
    });
  },
};
