import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Laptop, Loader2, ShieldAlert } from 'lucide-react';
import { devicesApi } from '../../api/devices';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { btn, card, errorBox } from '../../components/ui/styles';

const PLATFORM_NAMES: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

/**
 * Only a port on this machine's loopback may receive the approval (RFC 8252),
 * the same rule the server applies: a crafted link cannot send it elsewhere.
 */
function loopbackRedirect(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname);
    return url.protocol === 'http:' && loopback && url.port && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/**
 * Opened by a desktop app in the browser: the signed-in user approves it, and
 * the page hands a one-time code back to the app's loopback address. The app
 * redeems it with the PKCE verifier only it holds.
 */
const ConnectDevicePage = () => {
  const { t } = useI18n();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const redirect = loopbackRedirect(params.get('redirect_uri'));
  const challenge = params.get('code_challenge') ?? '';
  const method = params.get('code_challenge_method');
  const deviceName = (params.get('device_name') ?? '').trim().slice(0, 64);
  const platform = params.get('platform') ?? 'other';
  const state = params.get('state');
  const valid = redirect !== null && method === 'S256' && /^[A-Za-z0-9_-]{43}$/.test(challenge) && deviceName !== '';

  const sendBack = (values: Record<string, string>) => {
    const target = new URL(redirect!.toString());
    for (const [key, value] of Object.entries(values)) target.searchParams.set(key, value);
    if (state) target.searchParams.set('state', state);
    window.location.href = target.toString();
  };

  const approve = async () => {
    setError('');
    setBusy(true);
    try {
      const { code } = await devicesApi.authorize({
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        redirectUri: redirect!.toString(),
        deviceName,
        platform,
      });
      setDone(true);
      sendBack({ code });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
      setBusy(false);
    }
  };

  return (
    <div className="flex justify-center py-8">
      <div className={`${card} w-full max-w-lg p-8`}>
        {!valid ? (
          <div className="flex items-start gap-3">
            <ShieldAlert size={22} className="mt-0.5 shrink-0 text-rose-500" />
            <div>
              <h1 className="font-semibold text-slate-900 dark:text-slate-100">{t('connect.invalidTitle')}</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('connect.invalidHint')}</p>
            </div>
          </div>
        ) : done ? (
          <div className="flex items-start gap-3">
            <Check size={22} className="mt-0.5 shrink-0 text-emerald-500" />
            <div>
              <h1 className="font-semibold text-slate-900 dark:text-slate-100">{t('connect.doneTitle')}</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('connect.doneHint')}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-4">
              <div className="rounded-xl bg-[var(--accent-600)] p-3 text-white">
                <Laptop size={24} />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('connect.title')}</h1>
                <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                  {deviceName} · {PLATFORM_NAMES[platform] ?? t('devices.platformOther')}
                </p>
              </div>
            </div>

            <p className="text-sm text-slate-700 dark:text-slate-300">
              {t('connect.question', { device: deviceName, user: user?.username ?? '' })}
            </p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t('connect.hint')}</p>

            {error && <div className={`${errorBox} mt-4`}>{error}</div>}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => sendBack({ error: 'access_denied' })} className={btn.secondary}>
                {t('connect.deny')}
              </button>
              <button type="button" disabled={busy} onClick={() => void approve()} className={btn.primary}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {t('connect.approve')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ConnectDevicePage;
