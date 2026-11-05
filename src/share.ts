// Share a screen element as a PNG: the phone's share sheet (Telegram etc.) where files can be shared, else a download.
import { toBlob } from 'html-to-image';

export async function sharePng(node: HTMLElement, fileName: string): Promise<void> {
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
  const blob = await toBlob(node, { pixelRatio: 2, backgroundColor: paper || undefined });
  if (!blob) return;
  const file = new File([blob], fileName, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      return await navigator.share({ files: [file] });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // the user closed the share sheet
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
