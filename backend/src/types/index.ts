/** A real light/dark switch. 'system' follows the visitor's OS preference. */
export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Just the accent color family — works under either mode. */
export const THEME_SKINS = [
  'default',
  'ocean',
  'sunset',
  'forest',
  'grape',
  'crimson',
  'solar',
  'arctic',
  'mint',
  'blossom',
  'ares',
  'poseidon',
  'zeus',
  'jade',
  'verdigris',
  'nebula',
  'sakura',
  'slate',
  'mono',
  'graphite',
  'ash',
  'terracotta',
] as const;
export type ThemeSkin = (typeof THEME_SKINS)[number];

export interface User {
  id: string;
  email: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  avatar_path: string | null;
  role: 'admin' | 'user';
  is_active: number;
  theme_mode: ThemeMode;
  theme_skin: ThemeSkin;
  created_at: string;
  updated_at: string;
}

export type PublicUser = Omit<User, 'password_hash'>;

export interface Session {
  id: string;
  user_id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export interface FolderGrant {
  id: string;
  user_id: string;
  folder_path: string;
  can_read: number;
  can_write: number;
  inherit: number;
  created_by: string | null;
  created_at: string;
}

export interface Share {
  id: string;
  owner_user_id: string;
  target_path: string;
  target_type: 'file' | 'folder';
  /** Last segment of the public URL. */
  name: string;
  /** NULL means the link is published under the random token instead of an alias. */
  path_name_id: string | null;
  allow_download: number;
  allow_upload: number;
  password_hash: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}
