import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getRuntimeConfig } from '../api/config';

interface Branding {
  /** Product name used in copy and image alt text. */
  appName: string;
  /** Browser tab title. */
  appTitle: string;
}

const FALLBACK: Branding = { appName: 'Webin Cloud', appTitle: 'Webin Cloud Server' };

const AppConfigContext = createContext<Branding>(FALLBACK);

/** Names come from the server so they can be changed without a rebuild. */
export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(FALLBACK);

  useEffect(() => {
    getRuntimeConfig()
      .then((config) =>
        setBranding({
          appName: config.appName || FALLBACK.appName,
          appTitle: config.appTitle || FALLBACK.appTitle,
        }),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    document.title = branding.appTitle;
  }, [branding.appTitle]);

  return <AppConfigContext.Provider value={branding}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig() {
  return useContext(AppConfigContext);
}
