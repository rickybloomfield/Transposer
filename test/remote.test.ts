import { describe, expect, it } from 'vitest';
import { fetchRemoteScore, fileNameOf, RemoteScoreError, scoreUrlCandidates } from '../src/remote';

const PDF = 'https://defordmusic.com/wp-content/uploads/1b-solo-be-still-my-soul-viola.pdf';

describe('scoreUrlCandidates', () => {
  it('looks beside a PDF for the files the parsers can read', () => {
    expect(scoreUrlCandidates(PDF)).toEqual([
      'https://defordmusic.com/wp-content/uploads/1b-solo-be-still-my-soul-viola.pc',
      'https://defordmusic.com/wp-content/uploads/1b-solo-be-still-my-soul-viola.dorico',
    ]);
  });

  it('uses a .pc or .dorico link as-is', () => {
    expect(scoreUrlCandidates('https://example.com/a.pc')).toEqual(['https://example.com/a.pc']);
    expect(scoreUrlCandidates('https://example.com/a.dorico')).toEqual(['https://example.com/a.dorico']);
  });

  it('keeps the query string and ignores extension case', () => {
    expect(scoreUrlCandidates('https://example.com/song.PDF?ver=2')[0]).toBe('https://example.com/song.pc?ver=2');
  });

  it('trims surrounding whitespace', () => {
    expect(scoreUrlCandidates(`  ${PDF} `)[0]).toContain('.pc');
  });

  it('passes an extensionless address through, for servers that hide the extension', () => {
    expect(scoreUrlCandidates('https://example.com/scores/42')).toEqual(['https://example.com/scores/42']);
  });

  it('rejects anything that is not an https address', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'not a url', 'http://example.com/a.pc']) {
      expect(() => scoreUrlCandidates(bad)).toThrow(RemoteScoreError);
    }
  });

  it('allows http on localhost, so the dev server can serve fixtures', () => {
    expect(scoreUrlCandidates('http://localhost:5173/a.pc')).toEqual(['http://localhost:5173/a.pc']);
  });
});

describe('fileNameOf', () => {
  it('takes the last path segment and decodes it', () => {
    expect(fileNameOf('https://example.com/a/b/be%20still.pc')).toBe('be still.pc');
  });
});

describe('fetchRemoteScore', () => {
  const ok = (body: string) => new Response(body, { status: 200 });

  it('returns the first candidate that exists, named after its URL', async () => {
    const seen: string[] = [];
    const fake = (async (url: string) => {
      seen.push(url);
      return url.endsWith('.dorico') ? ok('zip') : new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const { file, url } = await fetchRemoteScore(scoreUrlCandidates(PDF), fake);
    expect(seen).toHaveLength(2);
    expect(url).toContain('.dorico');
    expect(file.name).toBe('1b-solo-be-still-my-soul-viola.dorico');
  });

  it('reports a rejected request as blocked, so the app can offer a download instead', async () => {
    const fake = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(fetchRemoteScore(['https://example.com/a.pc'], fake)).rejects.toMatchObject({ kind: 'blocked' });
  });

  it('reports 404s as missing rather than blocked', async () => {
    const fake = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchRemoteScore(['https://example.com/a.pc'], fake)).rejects.toMatchObject({ kind: 'missing' });
  });

  it('skips an empty body, which some hosts return instead of a 404', async () => {
    const fake = (async (url: string) =>
      url.endsWith('.pc') ? ok('') : ok('zip')) as unknown as typeof fetch;
    const { url } = await fetchRemoteScore(scoreUrlCandidates(PDF), fake);
    expect(url).toContain('.dorico');
  });
});
