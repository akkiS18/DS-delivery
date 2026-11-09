import type { RangeResponse, Source } from 'pmtiles';

/**
 * The offline map read from memory. In the APK the file is a local asset: it is read once and every tile is a slice of that buffer, so the map
 * does not depend on the local web server answering HTTP range requests. (In Telegram the file is read with range requests instead.)
 */
export class BufferSource implements Source {
  constructor(private readonly key: string, private readonly data: ArrayBuffer) {}
  getKey(): string { return this.key; }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: this.data.slice(offset, offset + length) };
  }
}

export async function loadWholeFile(url: string, fetchFn: typeof fetch = fetch): Promise<ArrayBuffer> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`MAP_FILE_${res.status}`);
  return res.arrayBuffer();
}
