import { describe, expect, it } from 'vitest';
import type { Score } from '../src/model/types';
import { DIVISIONS } from '../src/model/types';
import { writeMusicXml } from '../src/musicxml/writeMusicXml';

describe('MusicXML writer', () => {
  it('renders the score title as a prominent bold credit', () => {
    const score: Score = {
      title: 'Sample Song',
      parts: [{
        id: 'P1',
        name: 'Instrument',
        staffCount: 1,
        measures: [{
          number: 1,
          key: 0,
          time: { beats: 4, beatType: 4 },
          length: DIVISIONS * 4,
          staves: [{ events: [], directions: [] }]
        }]
      }],
      warnings: [],
      source: { format: 'pc' }
    };

    expect(writeMusicXml(score)).toContain('<credit-type>title</credit-type><credit-words default-x="600" default-y="1480" justify="center" valign="top" font-size="36" font-weight="bold" font-style="italic">Sample Song</credit-words>');
  });
});
