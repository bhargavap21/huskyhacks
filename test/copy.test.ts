import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A11: banner and UI copy never labels a person (snapshot of the copy sources).
const BANNED = /\b(scammer|fraudster|criminal|malicious|crook|con artist)s?\b|\bis (definitely )?a scam\b|\bdefinitely (safe|a scam)\b/i;
test('member and employee copy never calls a person malicious or gives a verdict', () => {
  for (const f of ['public/app.js', 'public/index.html', 'public/about.html', 'src/rules.ts']) {
    const m = readFileSync(f, 'utf8').match(BANNED);
    assert.equal(m, null, `${f} contains "${m?.[0]}"`);
  }
});
