import { api } from './client';
import type { User } from './types';

export interface CreateUserInput {
  email: string;
  username: string;
  password: string;
  displayName?: string | null;
  role: 'admin' | 'user';
}

export interface UpdateUserInput {
  email?: string;
  displayName?: string | null;
  role?: 'admin' | 'user';
  isActive?: boolean;
  password?: string;
}

export interface FolderGrant {
  id: string;
  user_id: string;
  folder_path: string;
  can_read: number;
  can_write: number;
  inherit: number;
  created_at: string;
}

export const usersApi = {
  list: () => api.get<User[]>('/users'),
  create: (input: CreateUserInput) => api.post<User>('/users', input),
  update: (id: string, input: UpdateUserInput) => api.patch<User>(`/users/${id}`, input),
  remove: (id: string) => api.del<void>(`/users/${id}`),
};

export const permissionsApi = {
  listByUser: (userId: string) => api.get<FolderGrant[]>(`/permissions?userId=${encodeURIComponent(userId)}`),
  create: (input: {
    userId: string;
    folderPath: string;
    canRead: boolean;
    canWrite: boolean;
    createFolder?: boolean;
  }) => api.post<FolderGrant>('/permissions', input),
  update: (id: string, input: { canRead?: boolean; canWrite?: boolean }) =>
    api.patch<FolderGrant>(`/permissions/${id}`, input),
  remove: (id: string) => api.del<void>(`/permissions/${id}`),
};
