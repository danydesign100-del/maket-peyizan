// Local API client for non-Supabase backend
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    full_name: string;
    role: {
      code: string;
      name: string;
    };
  };
}

interface Profile {
  id: string;
  full_name: string;
  email: string;
  role_id: string;
  active: boolean;
  role_code: string;
  role_name: string;
}

export type LocalRole = {
  id: string;
  code: string;
  name: string;
  description: string | null;
};

export type LocalManagedUser = {
  id: string;
  full_name: string;
  email: string;
  active: boolean | number;
  role_id: string;
  role: { code: string; name: string };
};

export type LocalSetting = {
  id: string;
  key: string;
  value: unknown;
  description: string | null;
};

class LocalApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('local_auth_token', token);
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('local_auth_token');
    }
    return this.token;
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('local_auth_token');
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getToken();
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    return this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async getProfile(): Promise<Profile> {
    return this.request<Profile>('/auth/me');
  }

  async rpc<T>(functionName: string, params: Record<string, any>): Promise<T> {
    return this.request<T>(`/rpc/${functionName}`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  async query<T>(sql: string, params: any[] = []): Promise<T[]> {
    return this.request<T[]>('/query', {
      method: 'POST',
      body: JSON.stringify({ query: sql, params }),
    });
  }

  async mutate<T>(action: 'insert' | 'update', table: string, values: Record<string, unknown>, id?: string): Promise<T> {
    return this.request<T>('/data', {
      method: 'POST',
      body: JSON.stringify({ action, table, values, id }),
    });
  }

  async getManagedUsers(): Promise<{ users: LocalManagedUser[]; roles: LocalRole[] }> {
    return this.request('/admin/users');
  }

  async updateManagedUser(userId: string, values: { active?: boolean; role_id?: string }): Promise<LocalManagedUser> {
    return this.request(`/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
  }

  async getSettings(): Promise<LocalSetting[]> {
    return this.request('/admin/settings');
  }

  async updateSetting(key: string, value: unknown): Promise<LocalSetting> {
    return this.request(`/admin/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
  }
}

export const localApi = new LocalApiClient();
export type { LoginResponse, Profile };
