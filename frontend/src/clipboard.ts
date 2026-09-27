/**
 * navigator.clipboard is only exposed in secure contexts, so reaching the app
 * over plain HTTP on a LAN address leaves it undefined. Falls back to the
 * legacy selection-based copy, which still works there.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Blocked or denied; the fallback below may still succeed.
    }
  }

  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  // Off-screen but still selectable, and without scrolling the page to it.
  field.style.position = 'fixed';
  field.style.top = '0';
  field.style.left = '0';
  field.style.opacity = '0';
  document.body.appendChild(field);

  try {
    field.select();
    field.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
