import { useEffect, useState } from 'react';
import { Ban, Loader2, ShieldOff, Unlock } from 'lucide-react';
import { ApiError } from '../../../api/client';
import { ipAccessApi, type BannedIp, type IpAccessInfo, type RateLimitedIp, type RateLimitSource } from '../../../api/admin';
import { useI18n } from '../../../i18n/I18nContext';
import type { TranslationKey } from '../../../i18n/translations';
import { btn, card, errorBox, input, label } from '../../../components/ui/styles';

const POLL_MS = 3000;

/** "45s" under a minute, "3m 12s" beyond it. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const SOURCE_LABEL: Record<RateLimitSource, TranslationKey> = {
  login: 'ipAccess.sourceLogin',
  shareUnlock: 'ipAccess.sourceShareUnlock',
};

/** A row action that asks "are you sure?" inline instead of a modal — same pattern as the Services page's restart button. */
const ConfirmAction = ({
  labelKey,
  confirmKey,
  onConfirm,
}: {
  labelKey: TranslationKey;
  confirmKey: TranslationKey;
  onConfirm: () => Promise<void>;
}) => {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setConfirming(false);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500 dark:text-slate-400">{t(confirmKey)}</span>
        <button type="button" onClick={() => void run()} className={btn.danger}>
          {t('common.confirm')}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className={btn.secondary}>
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  return (
    <button type="button" onClick={() => setConfirming(true)} disabled={busy} className={btn.iconGhost} title={t(labelKey)}>
      {busy ? <Loader2 size={16} className="animate-spin" /> : labelKey === 'ipAccess.unblockButton' ? <Unlock size={16} /> : <ShieldOff size={16} />}
    </button>
  );
};

const IpAccessSection = () => {
  const { t } = useI18n();
  const [data, setData] = useState<IpAccessInfo | null>(null);
  const [error, setError] = useState('');
  const [newIp, setNewIp] = useState('');
  const [newReason, setNewReason] = useState('');
  const [banError, setBanError] = useState('');
  const [banning, setBanning] = useState(false);

  const load = () => ipAccessApi.get().then(setData);

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
    const interval = setInterval(() => void load().catch(() => undefined), POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const unblock = async (entry: RateLimitedIp) => {
    await ipAccessApi.clearRateLimit(entry.source, entry.ip);
    await load();
  };

  const unban = async (entry: BannedIp) => {
    await ipAccessApi.unban(entry.ip);
    await load();
  };

  const submitBan = async () => {
    setBanning(true);
    setBanError('');
    try {
      await ipAccessApi.ban(newIp.trim(), newReason.trim() || undefined);
      setNewIp('');
      setNewReason('');
      await load();
    } catch (err) {
      setBanError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setBanning(false);
    }
  };

  if (error) return <div className={errorBox}>{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <section className={`${card} p-6`}>
        <h2 className="font-semibold text-slate-900 dark:text-slate-100">{t('ipAccess.rateLimitedTitle')}</h2>
        <p className="mt-1 mb-4 text-sm text-slate-500 dark:text-slate-400">{t('ipAccess.rateLimitedHint')}</p>

        {data.rateLimited.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('ipAccess.noRateLimited')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  <th className="py-2 pr-4 font-medium">{t('ipAccess.colIp')}</th>
                  <th className="py-2 pr-4 font-medium">{t('ipAccess.colSource')}</th>
                  <th className="py-2 pr-4 font-medium">{t('ipAccess.colHits')}</th>
                  <th className="py-2 pr-4 font-medium">{t('ipAccess.colRetry')}</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.rateLimited.map((entry) => (
                  <tr key={`${entry.source}-${entry.ip}`}>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-700 dark:text-slate-300">{entry.ip}</td>
                    <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{t(SOURCE_LABEL[entry.source])}</td>
                    <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{entry.hits}</td>
                    <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">{formatDuration(entry.retryAfterSeconds)}</td>
                    <td className="py-2 text-right">
                      <ConfirmAction
                        labelKey="ipAccess.unblockButton"
                        confirmKey="ipAccess.unblockConfirm"
                        onConfirm={() => unblock(entry)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`${card} p-6`}>
        <h2 className="font-semibold text-slate-900 dark:text-slate-100">{t('ipAccess.bannedTitle')}</h2>
        <p className="mt-1 mb-4 text-sm text-slate-500 dark:text-slate-400">{t('ipAccess.bannedHint')}</p>

        {banError && <div className={`${errorBox} mb-4`}>{banError}</div>}

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label className={label} htmlFor="ip-access-new-ip">
              {t('ipAccess.ipLabel')}
            </label>
            <input
              id="ip-access-new-ip"
              value={newIp}
              onChange={(e) => setNewIp(e.target.value)}
              placeholder={t('ipAccess.ipPlaceholder')}
              className={input}
            />
          </div>
          <div>
            <label className={label} htmlFor="ip-access-new-reason">
              {t('ipAccess.reasonLabel')}
            </label>
            <input
              id="ip-access-new-reason"
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              placeholder={t('ipAccess.reasonPlaceholder')}
              className={input}
            />
          </div>
          <button type="button" onClick={() => void submitBan()} disabled={banning || !newIp.trim()} className={btn.danger}>
            {banning ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
            {t('ipAccess.banButton')}
          </button>
        </div>

        {data.banned.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('ipAccess.noBanned')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  <th className="py-2 pr-4 font-medium">{t('ipAccess.colIp')}</th>
                  <th className="py-2 pr-4 font-medium">{t('ipAccess.colReason')}</th>
                  <th className="py-2 pr-4 font-medium">{t('ipAccess.colAddedBy')}</th>
                  <th className="py-2 pr-4 font-medium">{t('ipAccess.colAddedAt')}</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.banned.map((entry) => (
                  <tr key={entry.ip}>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-700 dark:text-slate-300">{entry.ip}</td>
                    <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{entry.reason ?? '—'}</td>
                    <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{entry.createdBy ?? '—'}</td>
                    <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 text-right">
                      <ConfirmAction
                        labelKey="ipAccess.removeButton"
                        confirmKey="ipAccess.removeConfirm"
                        onConfirm={() => unban(entry)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default IpAccessSection;
