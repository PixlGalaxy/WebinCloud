import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Calendar, Check, Copy, Link2, Loader2 } from 'lucide-react';
import { sharesApi, type PathName, type Share } from '../../api/shares';
import type { DirEntry } from '../../api/files';
import { ApiError } from '../../api/client';
import { copyText } from '../../clipboard';
import { useI18n } from '../../i18n/I18nContext';
import Modal from '../../components/ui/Modal';
import { btn, errorBox, input } from '../../components/ui/styles';

interface Props {
  entry: DirEntry;
  onClose: () => void;
}

const ShareCreateModal = ({ entry, onClose }: Props) => {
  const { t } = useI18n();
  const navigate = useNavigate();

  const [existing, setExisting] = useState<Share[] | null>(null);
  const [forceNew, setForceNew] = useState(false);
  const [pathNames, setPathNames] = useState<PathName[]>([]);
  const [useAbsolute, setUseAbsolute] = useState(false);
  const [pathNameId, setPathNameId] = useState<string | null>(null);
  const [allowDownload, setAllowDownload] = useState(true);
  const [allowUpload, setAllowUpload] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [useExpiry, setUseExpiry] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [created, setCreated] = useState<Share | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    sharesApi
      .listPathNames()
      .then((names) => {
        setPathNames(names);
        setPathNameId(names[0]?.id ?? null);
      })
      .catch(() => undefined);
  }, []);

  // Sharing the same item twice is allowed, but rarely what someone means to do.
  useEffect(() => {
    sharesApi
      .list()
      .then((all) => setExisting(all.filter((share) => share.target_path === entry.path)))
      .catch(() => setExisting([]));
  }, [entry.path]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      setCreated(
        await sharesApi.create({
          path: entry.path,
          allowDownload,
          allowUpload,
          password: usePassword && password ? password : null,
          expiresAt: useExpiry && expiresAt ? new Date(expiresAt).toISOString() : null,
          pathNameId: useAbsolute ? pathNameId : null,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setSaving(false);
    }
  };

  const fullUrl = created ? `${window.location.origin}${created.url}` : '';

  if (created) {
    return (
      <Modal title={t('share.created')} onClose={onClose}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('share.createdHint')}</p>

          <div className="flex gap-2">
            <input readOnly value={fullUrl} className={`${input} font-mono text-xs`} />
            <button
              onClick={() => void copyText(fullUrl).then(setCopied)}
              className={btn.primary}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? t('share.copied') : t('share.copy')}
            </button>
          </div>

          <div className="flex justify-end">
            <button onClick={onClose} className={btn.secondary}>
              {t('common.close')}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  if (existing === null) {
    return (
      <Modal title={t('share.title', { name: entry.name })} onClose={onClose}>
        <div className="flex justify-center py-8">
          <Loader2 className="animate-spin text-[var(--accent-500)]" size={28} />
        </div>
      </Modal>
    );
  }

  if (existing.length > 0 && !forceNew) {
    return (
      <Modal title={t('share.alreadyShared')} onClose={onClose}>
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p>{t('share.alreadySharedHint', { name: entry.name, count: existing.length })}</p>
          </div>

          <ul className="space-y-2">
            {existing.map((share) => (
              <li
                key={share.id}
                className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700"
              >
                <code className="block truncate font-mono text-xs text-[var(--accent-600)] dark:text-[var(--accent-400)]">
                  {share.url}
                </code>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {share.pathName ?? t('share.randomToken')}
                  {share.hasPassword ? ` · ${t('share.hasPassword')}` : ''}
                  {share.expires_at ? ` · ${t('share.expiresOn')}` : ` · ${t('share.neverExpires')}`}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={() => setForceNew(true)} className={btn.secondary}>
              {t('share.createAnother')}
            </button>
            <button
              onClick={() => navigate(`/share?path=${encodeURIComponent(entry.path)}`)}
              className={btn.primary}
            >
              {t('share.goToExisting')}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t('share.title', { name: entry.name })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-5">
        {error && <div className={errorBox}>{error}</div>}

        <div className="space-y-2">
          <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={allowDownload}
              onChange={(e) => setAllowDownload(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[var(--accent-600)] focus:ring-[var(--accent-500)]"
            />
            {t('share.allowDownload')}
          </label>

          {entry.type === 'folder' && (
            <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={allowUpload}
                onChange={(e) => setAllowUpload(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-[var(--accent-600)] focus:ring-[var(--accent-500)]"
              />
              {t('share.allowUpload')}
            </label>
          )}
        </div>

        <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
          <label className="flex items-center gap-2.5 text-sm font-medium text-slate-800 dark:text-slate-100">
            <input
              type="checkbox"
              checked={useAbsolute}
              onChange={(e) => setUseAbsolute(e.target.checked)}
              disabled={pathNames.length === 0}
              className="h-4 w-4 rounded border-slate-300 text-[var(--accent-600)] focus:ring-[var(--accent-500)]"
            />
            <Link2 size={15} className="text-[var(--accent-500)]" />
            {t('share.absolutePath')}
          </label>

          {useAbsolute ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {pathNames.map((pathName) => (
                <button
                  key={pathName.id}
                  type="button"
                  onClick={() => setPathNameId(pathName.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                    pathNameId === pathName.id
                      ? 'bg-[var(--accent-600)] text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {pathName.name}
                </button>
              ))}
            </div>
          ) : null}

          <p className="mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">
            /public/
            {useAbsolute ? (pathNames.find((p) => p.id === pathNameId)?.name ?? '…') : t('share.randomToken')}/
            {entry.name}
          </p>
        </div>

        <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
          <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={usePassword}
              onChange={(e) => setUsePassword(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[var(--accent-600)] focus:ring-[var(--accent-500)]"
            />
            {t('share.protectWithPassword')}
          </label>
          {usePassword && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.password')}
              className={input}
            />
          )}

          <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={useExpiry}
              onChange={(e) => setUseExpiry(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[var(--accent-600)] focus:ring-[var(--accent-500)]"
            />
            <Calendar size={15} className="text-[var(--accent-500)]" />
            {t('share.setExpiry')}
          </label>
          {useExpiry ? (
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className={input}
            />
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('share.neverExpires')}</p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btn.secondary}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={saving} className={btn.primary}>
            {saving && <Loader2 className="animate-spin" size={16} />}
            {t('share.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ShareCreateModal;
