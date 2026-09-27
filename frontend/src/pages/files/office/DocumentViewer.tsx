import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { Loader2 } from 'lucide-react';
import { useI18n } from '../../../i18n/I18nContext';
import { errorBox } from '../../../components/ui/styles';

interface Props {
  url: string;
}

/** Renders a .docx fetched from `url` as HTML, laid out to look like the original page. */
const DocumentViewer = ({ url }: Props) => {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    let cancelled = false;
    element.innerHTML = '';
    setLoading(true);
    setError('');

    fetch(url, { credentials: 'include' })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (cancelled) return;
        return renderAsync(blob, element, undefined, {
          ignoreFonts: true,
          renderFooters: false,
          renderFootnotes: false,
          renderEndnotes: false,
        });
      })
      .catch((err) => {
        console.error('DocumentViewer failed to render', url, err);
        if (cancelled) return;
        // A .docx is a zip; this exact message means the bytes aren't one at all —
        // almost always a legacy .doc (or another format) saved with a .docx name.
        const notAZip = err instanceof Error && /zip file/i.test(err.message);
        setError(t(notAZip ? 'files.previewNotOfficeFormat' : 'files.previewFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      element.innerHTML = '';
    };
  }, [url, t]);

  return (
    <div className="h-full overflow-auto bg-slate-200 p-6 dark:bg-slate-950">
      {loading && (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="animate-spin text-indigo-500" size={32} />
        </div>
      )}
      {error && <div className={`${errorBox} mx-auto max-w-2xl`}>{error}</div>}
      {/* docx-preview renders its own page elements into this container. */}
      <div ref={container} className={`docx-preview mx-auto ${loading || error ? 'hidden' : ''}`} />
    </div>
  );
};

export default DocumentViewer;
