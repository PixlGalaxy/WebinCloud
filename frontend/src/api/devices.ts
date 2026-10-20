import { api } from './client';

export interface Device {
  id: string;
  name: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string | null;
  lastIp: string | null;
  /** True for the device making the request; never for the browser. */
  current: boolean;
}

export interface AuthorizeInput {
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  redirectUri: string;
  deviceName: string;
  platform: string;
}

export const devicesApi = {
  list: () => api.get<Device[]>('/devices'),
  revoke: (id: string) => api.del<void>(`/devices/${encodeURIComponent(id)}`),
  /** Approves a desktop app from the signed-in browser; the code goes back to the app. */
  authorize: (input: AuthorizeInput) => api.post<{ code: string }>('/devices/authorize', input),
};
