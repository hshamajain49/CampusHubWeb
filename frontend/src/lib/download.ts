// Authenticated file downloads (§9.8): blob → object URL → temporary <a download>.
import { toast } from 'sonner';
import { apiFetchWithResponse, ApiError, type ApiOptions } from './api-client';

export async function downloadFile(path: string, fallbackName: string, query?: ApiOptions['query']): Promise<void> {
  try {
    const { data, res } = await apiFetchWithResponse<Blob>(path, { responseType: 'blob', query });
    const blob = data;
    const disposition = res.headers.get('content-disposition') ?? '';
    const name = /filename="?([^"]+)"?/i.exec(disposition)?.[1] ?? fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : "Couldn't download the file. Please try again.");
    throw err;
  }
}
