import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import type { User } from '../api/types';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  /** True right after logging in with the default "changeme" password. */
  mustChangePassword: boolean;
  /** True right after logging in as the seeded "admin"/"changeme" account — a superset of mustChangePassword. */
  mustCompleteSetup: boolean;
  login: (usernameOrEmail: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Lets pages that change the signed-in user (e.g. the avatar) sync it back. */
  updateUser: (user: User) => void;
  /** Clears the forced-change prompt once the password has actually been changed. */
  clearMustChangePassword: () => void;
  /** Clears the forced-setup prompt once username/email/password have actually been replaced. */
  clearMustCompleteSetup: () => void;
}

interface SessionInfo {
  user: User;
  mustChangePassword: boolean;
  mustCompleteSetup: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [mustCompleteSetup, setMustCompleteSetup] = useState(false);

  useEffect(() => {
    // Same shape as /login: the forced setup/password prompt survives a reload,
    // which matters because the server refuses everything else until it's done.
    api
      .get<SessionInfo>('/auth/me')
      .then(({ user, mustChangePassword, mustCompleteSetup }) => {
        setUser(user);
        setMustChangePassword(mustChangePassword);
        setMustCompleteSetup(mustCompleteSetup);
      })
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (usernameOrEmail: string, password: string) => {
    const { user, mustChangePassword, mustCompleteSetup } = await api.post<SessionInfo>('/auth/login', {
      usernameOrEmail,
      password,
    });
    setUser(user);
    setMustChangePassword(mustChangePassword);
    setMustCompleteSetup(mustCompleteSetup);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch (err) {
      // A forced password change already invalidates the session server-side.
      if (!(err instanceof ApiError && err.status === 401)) throw err;
    } finally {
      setUser(null);
      setMustChangePassword(false);
      setMustCompleteSetup(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        mustChangePassword,
        mustCompleteSetup,
        login,
        logout,
        updateUser: setUser,
        clearMustChangePassword: () => setMustChangePassword(false),
        clearMustCompleteSetup: () => setMustCompleteSetup(false),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
