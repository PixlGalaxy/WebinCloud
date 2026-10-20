import { useEffect, useState } from 'react';
import { Laptop, Loader2, X } from 'lucide-react';
import { usersApi } from '../../api/users';
import type { Device } from '../../api/devices';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { btn, errorBox } from '../../components/ui/styles';

const PLATFORM_NAMES: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

/** Beside the user form: the user's connected desktop apps, each of which the admin can disconnect. */
const UserDevicesPanel = ({ userId }: { userId: string }) => {
  const { t, language } = useI18n();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    usersApi
      .devices(userId)
      .then(setDevices)
      .catch((err) => setError(err instanceof ApiError ? err.message : t('files.loadFailed')));
  }, [userId, t]);

  // SQLite writes UTC as "YYYY-MM-DD HH:MM:SS", without the zone.
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(`${value.replace(' ', 'T')}Z`),
    );

  const revoke = async (device: Device) => {
    if (!window.confirm(t('users.disconnectDeviceConfirm', { device: device.name }))) return;
    setError('');
    setRevoking(device.id);
    try {
      await usersApi.revokeDevice(userId, device.id);
      setDevices((current) => current?.filter((d) => d.id !== device.id) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <aside className="min-w-0 border-t border-slate-200 pt-5 dark:border-slate-700 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        <Laptop size={16} className="text-[var(--accent-500)]" />
        {t('users.devicesSection')}
      </h3>
      <p className="mt-1 mb-4 text-xs text-slate-500 dark:text-slate-400">{t('users.devicesHint')}</p>

      {error && <div className={`${errorBox} mb-3`}>{error}</div>}

      {devices === null ? (
        !error && <Loader2 className="mx-auto animate-spin text-[var(--accent-500)]" size={22} />
      ) : devices.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {t('users.devicesNone')}
        </p>
      ) : (
        <ul className="space-y-2">
          {devices.map((device) => (
            <li key={device.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={device.name}>
                    {device.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {PLATFORM_NAMES[device.platform] ?? t('devices.platformOther')}
                    {device.lastIp && ` · ${device.lastIp}`}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={revoking === device.id}
                  onClick={() => void revoke(device)}
                  className={btn.iconDanger}
                  title={t('devices.disconnect')}
                  aria-label={t('devices.disconnect')}
                >
                  {revoking === device.id ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                {t('devices.connectedOn', { date: formatDate(device.createdAt) })}
                {device.lastSeenAt && (
                  <>
                    <br />
                    {t('devices.lastSeen', { date: formatDate(device.lastSeenAt) })}
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
};

export default UserDevicesPanel;
