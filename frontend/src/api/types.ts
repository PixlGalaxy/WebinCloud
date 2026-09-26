export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  avatar_path: string | null;
  role: 'admin' | 'user';
  is_active: number;
  created_at: string;
  updated_at: string;
}
