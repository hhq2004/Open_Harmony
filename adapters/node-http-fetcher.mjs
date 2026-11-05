/** Real HTTP JSON prefetch for Node 22 host validation; not an OpenHarmony SDK adapter. */
export class NodeHttpDataFetcher {
  constructor({ resolveUrl, validate, maxResponseBytes = 1024 * 1024 }) {
    if (typeof resolveUrl !== 'function' || typeof validate !== 'function') {
      throw new TypeError('Provide an allowlisted URL resolver and data validator.');
    }
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) throw new RangeError('Invalid response limit.');
    this.resolveUrl = resolveUrl;
    this.validate = validate;
    this.maxResponseBytes = maxResponseBytes;
  }

  start(request) {
    const abort = new AbortController();
    const result = this.load(request, abort.signal);
    return { result, cancel: () => abort.abort() };
  }

  async load(request, signal) {
    const url = new URL(this.resolveUrl(request));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new TypeError('Unsupported data URL.');
    }
    const response = await fetch(url, { signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('HTTP prefetch failed.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing response body.');
    const chunks = [];
    let byteLength = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > this.maxResponseBytes) throw new RangeError('Response exceeds prefetch limit.');
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
    let payload = JSON.parse(Buffer.concat(chunks, byteLength).toString('utf8'));
    if (this.validate(payload, request) !== true) throw new TypeError('Invalid prefetch payload.');
    let disposed = false;
    return Object.freeze({
      byteLength,
      get value() {
        if (disposed) throw new Error('Data lease was disposed.');
        return payload;
      },
      dispose() { if (!disposed) { disposed = true; payload = undefined; } },
    });
  }
}
