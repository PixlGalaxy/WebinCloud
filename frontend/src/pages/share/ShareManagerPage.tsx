import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AppWindow,
  Calendar,
  Check,
  ExternalLink,
  File as FileIcon,
  Folder,
  Loader2,
  Lock,
  Server,
  Share2,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react';
import { publicShareApi, sharesApi, type PathName, type Share } from '../../api/shares';
import { ApiError } from '../../api/client';
import { copyText } from '../../clipboard';
import { useI18n } from '../../i18n/I18nContext';
import Modal from '../../components/ui/Modal';
import Toast from '../../components/ui/Toast';
import { btn, card, errorBox, input, label } from '../../components/ui/styles';

const ShareManagerPage = () => {
  const { t, language } = useI18n();
  const [shares, setShares] = useState<Share[] | null>(null);
  const [pathNames, setPathNames] = useState<PathName[]>([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editing, setEditing] = useState<Share | null>(null);
  const [deleting, setDeleting] = useState<Share | null>(null);
  const [searchParams] = useSearchParams();
  const highlighted = searchParams.get('path');
  const highlightedRef = useRef<HTMLLIElement>(null);

  const reload = useCallback(async () => {
    setError('');
    try {
      const [list, names] = await Promise.all([sharesApi.list(), sharesApi.listPathNames()]);
      setShares(list);
      setPathNames(names);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  // Every link to the same item shares one card, so duplicates are obvious.
  const groups = useMemo(() => {
    const byPath = new Map<string, Share[]>();
    for (const share of shares ?? []) {
      const existing = byPath.get(share.target_path);
      if (existing) existing.push(share);
      else byPath.set(share.target_path, [share]);
    }
    return [...byPath.entries()].map(([targetPath, links]) => ({ targetPath, links }));
  }, [shares]);

  // Arriving from "this is already shared" scrolls to and outlines the card.
  useEffect(() => {
    if (highlighted && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlighted, groups]);

  const copy = async (key: string, path: string, kind: string) => {
    const url = `${window.location.origin}${path}`;
    if (!(await copyText(url))) {
      setError(t('share.copyFailed', { url }));
      return;
    }

    setCopied(key);
    setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);

    const message = t('share.urlCopied', { kind });
    setToast(message);
    setTimeout(() => setToast((current) => (current === message ? null : current)), 2000);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('page.shared')}</h1>

      {error && <div className={errorBox}>{error}</div>}

      {shares === null ? (
        <div className={`${card} flex justify-center p-12`}>
          <Loader2 className="animate-spin text-[var(--accent-500)]" size={28} />
        </div>
      ) : shares.length === 0 ? (
        <div className={`${card} p-12 text-center`}>
          <Share2 className="mx-auto mb-3 text-slate-300 dark:text-slate-600" size={44} />
          <p className="text-slate-500 dark:text-slate-400">{t('share.none')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li
              key={group.targetPath}
              ref={group.targetPath === highlighted ? highlightedRef : undefined}
              className={`${card} p-4 transition ${
                group.targetPath === highlighted ? 'ring-2 ring-[var(--accent-500)]' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                {group.links[0].target_type === 'folder' ? (
                  <Folder size={20} className="mt-0.5 shrink-0 text-[var(--accent-500)]" />
                ) : (
                  <FileIcon size={20} className="mt-0.5 shrink-0 text-slate-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                    {group.links[0].name}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{group.targetPath}</p>
                </div>
                {group.links.length > 1 && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {t('share.linkCount', { count: group.links.length })}
                  </span>
                )}
              </div>

              <ul className="mt-3 divide-y divide-slate-200 border-t border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                {group.links.map((share) => (
                  <li key={share.id} className="flex flex-wrap items-start gap-3 pt-3 first:pt-3">
                    <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                      <code className="block truncate font-mono text-xs text-[var(--accent-600)] dark:text-[var(--accent-400)]">
                        {share.url}
                      </code>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {share.pathName ? (
                      <span className="rounded-full bg-[var(--accent-50)] px-2 py-0.5 font-medium text-[var(--accent-700)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-300)]">
                        {share.pathName}
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {t('share.randomToken')}
                      </span>
                    )}

                    {share.allow_upload === 1 && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        <Upload size={11} /> {t('share.allowUpload')}
                      </span>
                    )}

                    <span
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${
                        share.hasPassword
                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {share.hasPassword ? <Lock size={11} /> : <Unlock size={11} />}
                      {share.hasPassword ? t('share.hasPassword') : t('share.noPassword')}
                    </span>

                    <span
                      className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${
                        share.expired
                          ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      <Calendar size={11} />
                      {share.expires_at
                        ? `${share.expired ? t('share.expired') : t('share.expiresOn')} ${formatDate(share.expires_at)}`
                        : t('share.neverExpires')}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <a
                    href={share.url}
                    target="_blank"
                    rel="noreferrer"
                    className={btn.iconGhost}
                    title={t('share.openPage')}
                  >
                    <ExternalLink size={16} />
                  </a>

                  <button
                    onClick={() => void copy(`${share.id}:front`, share.url, t('share.openFrontend'))}
                    title={t('share.copyFrontendHint')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-600"
                  >
                    {copied === `${share.id}:front` ? <Check size={16} /> : <AppWindow size={16} />}
                    {t('share.openFrontend')}
                  </button>

                  {share.target_type === 'file' && (
                    <button
                      onClick={() =>
                        void copy(
                          `${share.id}:back`,
                          publicShareApi.rawUrl(share.segment, share.name),
                          t('share.openBackend'),
                        )
                      }
                      title={t('share.copyBackendHint')}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-orange-600"
                    >
                      {copied === `${share.id}:back` ? <Check size={16} /> : <Server size={16} />}
                      {t('share.openBackend')}
                    </button>
                  )}

                  <button onClick={() => setEditing(share)} className={btn.secondary}>
                    {t('share.edit')}
                  </button>
                  <button
                    onClick={() => setDeleting(share)}
                    className={btn.iconDanger}
                    title={t('common.delete')}
                  >
                    <Trash2 size={16} />
                  </button>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {toast && <Toast message={toast} />}

      {editing && (
        <EditShareModal
          share={editing}
          pathNames={pathNames}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}

      {deleting && (
        <Modal title={t('share.delete')} onClose={() => setDeleting(null)}>
          <p className="text-slate-600 dark:text-slate-300">
            {t('share.confirmDelete', { name: deleting.name })}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setDeleting(null)} className={btn.secondary}>
              {t('common.cancel')}
            </button>
            <button
              onClick={async () => {
                await sharesApi.remove(deleting.id);
                setDeleting(null);
                void reload();
              }}
              className={btn.danger}
            >
              <Trash2 size={16} /> {t('common.delete')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

interface EditProps {
  share: Share;
  pathNames: PathName[];
  onClose: () => void;
  onSaved: () => void;
}

/** Expiry, password and path name can all be changed after the fact. */
const EditShareModal = ({ share, pathNames, onClose, onSaved }: EditProps) => {
  const { t } = useI18n();
  const [allowDownload, setAllowDownload] = useState(share.allow_download === 1);
  const [allowUpload, setAllowUpload] = useState(share.allow_upload === 1);
  const [useAbsolute, setUseAbsolute] = useState(share.path_name_id !== null);
  const [pathNameId, setPathNameId] = useState(share.path_name_id ?? pathNames[0]?.id ?? null);
  const [useExpiry, setUseExpiry] = useState(share.expires_at !== null);
  const [expiresAt, setExpiresAt] = useState(
    share.expires_at ? new Date(share.expires_at).toISOString().slice(0, 16) : '',
  );
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      await sharesApi.update(share.id, {
        allowDownload,
        allowUpload,
        pathNameId: useAbsolute ? pathNameId : null,
        expiresAt: useExpiry && expiresAt ? new Date(expiresAt).toISOString() : null,
        ...(clearPassword ? { password: '' } : password ? { password } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('share.edit')} onClose={onClose}>
      <div className="space-y-5">
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
          {share.target_type === 'folder' && (
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
            {t('share.absolutePath')}
          </label>

          {useAbsolute && (
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
          )}
        </div>

        <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
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

          <div>
            <label className={label} htmlFor="share-password">
              {share.hasPassword ? t('share.changePassword') : t('share.addPassword')}
            </label>
            <input
              id="share-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setClearPassword(false);
              }}
              placeholder={share.hasPassword ? t('users.passwordUnchanged') : ''}
              className={input}
              disabled={clearPassword}
            />
            {share.hasPassword && (
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={clearPassword}
                  onChange={(e) => {
                    setClearPassword(e.target.checked);
                    if (e.target.checked) setPassword('');
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-[var(--accent-600)] focus:ring-[var(--accent-500)]"
                />
                {t('share.removePassword')}
              </label>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btn.secondary}>
            {t('common.cancel')}
          </button>
          <button onClick={() => void save()} disabled={saving} className={btn.primary}>
            {saving && <Loader2 className="animate-spin" size={16} />}
            {t('common.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default ShareManagerPage;
