/**
 * Loading a score from a URL, so a link can open a specific song ready to transpose:
 * `…/Transposer/?score=https://example.com/songs/anthem-viola.pdf`.
 *
 * The parameter usually points at the PDF a visitor was already looking at; the app cannot read
 * a PDF, so it looks for the `.pc` or `.dorico` file published beside it. A `.pc` or `.dorico`
 * URL is used as-is.
 */

/** Extensions the parsers understand, tried in this order when swapping a `.pdf` extension. */
const SOURCE_EXTENSIONS = ['.pc', '.dorico'];

export type RemoteErrorKind =
  /** The URL was malformed, or not an http(s) address. */
  | 'invalid'
  /** The request never completed: CORS, DNS, or the network. */
  | 'blocked'
  /** The server answered, but there was no score file at any candidate URL. */
  | 'missing';

export class RemoteScoreError extends Error {
  constructor(message: string, readonly kind: RemoteErrorKind, readonly candidates: string[] = []) {
    super(message);
    this.name = 'RemoteScoreError';
  }
}

/**
 * Validate the `?score=` value and expand it into the URLs to try, in order.
 * Throws a `RemoteScoreError` for anything that is not a plain http(s) URL — this value comes
 * from the query string, so it must never reach an `href` unchecked.
 */
export function scoreUrlCandidates(input: string): string[] {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new RemoteScoreError(`“${trimmed}” is not a full URL. Include the https:// prefix.`, 'invalid');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url.hostname))) {
    throw new RemoteScoreError('Linked scores must be served over https.', 'invalid');
  }
  const ext = extensionOf(url.pathname);
  if (SOURCE_EXTENSIONS.includes(ext)) return [url.href];
  if (ext === '.pdf') return SOURCE_EXTENSIONS.map((e) => withExtension(url, e));
  // No extension, or one we don't recognize: the server may still be serving a .pc, which
  // `loadFile` detects from its magic bytes.
  return [url.href];
}

/** Fetch the first candidate that exists, as a `File` named after its URL. */
export async function fetchRemoteScore(
  candidates: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ file: File; url: string }> {
  let blocked = false;
  for (const url of candidates) {
    let res: Response;
    try {
      res = await fetchImpl(url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
    } catch {
      // A rejected fetch is opaque by design: CORS, DNS and offline all look the same here.
      blocked = true;
      continue;
    }
    if (!res.ok) continue;
    const blob = await res.blob();
    if (!blob.size) continue;
    return { file: new File([blob], fileNameOf(url)), url };
  }
  if (blocked) {
    throw new RemoteScoreError(
      'The browser blocked the request. The site hosting the file has to allow other sites to ' +
        'read it (an Access-Control-Allow-Origin header).',
      'blocked',
      candidates,
    );
  }
  throw new RemoteScoreError('No Personal Composer or Dorico file was found at that address.', 'missing', candidates);
}

/** The file name a downloaded candidate should carry, so the parsers see its extension. */
export function fileNameOf(url: string): string {
  const path = new URL(url).pathname;
  const last = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(last) || 'score';
  } catch {
    return last || 'score';
  }
}

function extensionOf(pathname: string): string {
  const dot = pathname.lastIndexOf('.');
  const slash = pathname.lastIndexOf('/');
  return dot > slash ? pathname.slice(dot).toLowerCase() : '';
}

/** Swap the extension, keeping the rest of the URL (a `?ver=` cache-buster included). */
function withExtension(url: URL, extension: string): string {
  const next = new URL(url.href);
  next.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('.')) + extension;
  return next.href;
}

function isLocal(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
