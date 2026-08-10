import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
    BACKUP_EXTENSION,
    BACKUP_SECTIONS,
    DEFAULT_SEPARATOR,
    MAX_PASSPHRASE_WORDS,
    MIN_PASSPHRASE_WORDS,
    MIN_PASSWORD_LENGTH,
    PASSPHRASE_SEPARATORS,
    WORDLIST,
    bitsPerGeneratedWord,
    defaultBackupFileName,
    estimatePassphraseStrength,
    estimatePasswordStrength,
    formatBytes,
    generatePassphraseWords,
    uniformIndicesFromBytes,
    joinPassphrase,
    validatePassphrase,
    validatePassword,
} from './core.ts';

// ---------------------------------------------------------------- passwords

test('a password is judged on length, not character classes', () => {
    // The whole point of the rule change: this satisfies "symbol, digit, capital" and is
    // still one of the first things any attacker tries.
    assert.equal(validatePassword('Password1!').ok, false);

    // No digits, no symbols, no capitals — and far stronger.
    assert.equal(validatePassword('correct horse battery staple').ok, true);
});

test('the length floor is enforced exactly', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    const exact = 'abcdefghijklmn'.slice(0, MIN_PASSWORD_LENGTH);

    assert.equal(validatePassword(short).ok, false);
    assert.deepEqual(
        validatePassword(short).problems.map((p) => p.code),
        ['tooShort'],
    );
    assert.equal(exact.length, MIN_PASSWORD_LENGTH);
    assert.equal(validatePassword(exact).ok, true);
});

test('obvious choices are rejected even when long enough', () => {
    const problems = validatePassword('mypasswordisgreat').problems.map((p) => p.code);
    assert.ok(problems.includes('obvious'));
});

test('the blocklist ignores padding and case', () => {
    // Someone dressing up a bad choice should not slip through.
    assert.equal(validatePassword('P-a-s-s-w-o-r-d-1-2-3').ok, false);
    assert.equal(validatePassword('ARSIVINYO_backup_2026').ok, false);
});

test('an empty password reports only that it is too short', () => {
    assert.deepEqual(
        validatePassword('').problems.map((p) => p.code),
        ['tooShort'],
    );
});

// ---------------------------------------------------------------- passphrases

test('a passphrase must have between four and twelve words', () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`);

    assert.equal(validatePassphrase(words(MIN_PASSPHRASE_WORDS - 1), '-').ok, false);
    assert.equal(validatePassphrase(words(MIN_PASSPHRASE_WORDS), '-').ok, true);
    assert.equal(validatePassphrase(words(MAX_PASSPHRASE_WORDS), '-').ok, true);
    assert.equal(validatePassphrase(words(MAX_PASSPHRASE_WORDS + 1), '-').ok, false);
});

test('a word containing the separator is rejected', () => {
    // Otherwise "two words" joined on a space silently becomes two entries, and the secret
    // is not the one the user believed they chose.
    const problems = validatePassphrase(['alpha', 'two words', 'gamma', 'delta'], ' ')
        .problems.map((p) => p.code);
    assert.ok(problems.includes('wordContainsSeparator'));

    // The same words are fine under a separator they do not contain.
    assert.equal(validatePassphrase(['alpha', 'two words', 'gamma', 'delta'], '-').ok, true);
});

test('a blank word among filled ones is reported', () => {
    const problems = validatePassphrase(['alpha', '', 'gamma', 'delta', 'epsilon'], '-')
        .problems.map((p) => p.code);
    assert.ok(problems.includes('blankWord'));
});

test('joining trims words and drops empties', () => {
    assert.equal(joinPassphrase(['  alpha ', 'beta', '', ' gamma'], '-'), 'alpha-beta-gamma');
});

test('every offered separator round-trips a phrase that does not contain it', () => {
    const words = ['alpha', 'beta', 'gamma', 'delta'];
    for (const separator of PASSPHRASE_SEPARATORS) {
        assert.equal(validatePassphrase(words, separator).ok, true, `separator ${separator}`);
        assert.equal(joinPassphrase(words, separator).split(separator).length, 4);
    }
});

test('the joined secret depends on the separator', () => {
    // A different separator is a different key; the two must not collide.
    const words = ['alpha', 'beta', 'gamma', 'delta'];
    assert.notEqual(joinPassphrase(words, '-'), joinPassphrase(words, '.'));
});

// ---------------------------------------------------------------- generation

test('the wordlist is exactly 256 distinct words, so each carries eight bits', () => {
    // The entropy shown to the user is derived from this length. If the list changes size
    // without the claim being rechecked, the meter starts lying.
    assert.equal(WORDLIST.length, 256);
    assert.equal(new Set(WORDLIST).size, 256);
    assert.equal(bitsPerGeneratedWord(), 8);
});

test('wordlist entries are easy to retype', () => {
    for (const word of WORDLIST) {
        assert.match(word, /^[a-z]{3,}$/, `${word} should be lowercase letters, 3+ long`);
    }
});

test('generation draws from the wordlist and honours the count', () => {
    let calls = 0;
    const sequence = [0, 1, 2, 3, 4, 5];
    const random = () => sequence[calls++ % sequence.length];

    const words = generatePassphraseWords(6, random);
    assert.equal(words.length, 6);
    assert.deepEqual(words, sequence.map((i) => WORDLIST[i]));
});

test('generation clamps the count into the allowed range', () => {
    const random = () => 0;
    assert.equal(generatePassphraseWords(1, random).length, MIN_PASSPHRASE_WORDS);
    assert.equal(generatePassphraseWords(99, random).length, MAX_PASSPHRASE_WORDS);
});

test('the generator only ever indexes inside the wordlist', () => {
    // A random source is asked for a bound; passing it through unchecked would be an
    // out-of-range read producing `undefined` words.
    const seen: number[] = [];
    generatePassphraseWords(12, (max) => {
        seen.push(max);
        return max - 1;
    });
    assert.ok(seen.every((max) => max === WORDLIST.length));
});

// ---------------------------------------------------------------- uniformity

test('every byte maps straight through for the shipped 256-word list', () => {
    // 256 divides 256, so nothing is rejected and no entropy is wasted.
    const all = Array.from({ length: 256 }, (_, i) => i);
    const indices = uniformIndicesFromBytes(all, 256, 256);
    assert.deepEqual(indices, all);
});

test('modulo bias is rejected, not folded, when the size is not a power of two', () => {
    // The bug this guards: with max=200, `byte % 200` would make 0..55 reachable from two
    // bytes each and 56..199 from one, so the first quarter of the list would be twice as
    // likely. Bytes at or above 200 must be discarded instead.
    const all = Array.from({ length: 256 }, (_, i) => i);
    const indices = uniformIndicesFromBytes(all, 200, 200)!;

    assert.equal(indices.length, 200);
    // Exactly one occurrence of each value: a perfectly flat distribution.
    const counts = new Map<number, number>();
    indices.forEach((i) => counts.set(i, (counts.get(i) ?? 0) + 1));
    assert.equal(counts.size, 200);
    assert.ok([...counts.values()].every((c) => c === 1));
});

test('a sweep of list sizes never produces a biased draw', () => {
    // Feed every possible byte exactly once and require a flat histogram for each size.
    const all = Array.from({ length: 256 }, (_, i) => i);
    for (const max of [2, 3, 7, 10, 16, 100, 128, 200, 255, 256]) {
        const limit = Math.floor(256 / max) * max;
        const indices = uniformIndicesFromBytes(all, limit, max)!;
        const counts = new Array(max).fill(0);
        indices.forEach((i) => {
            assert.ok(i >= 0 && i < max, `index ${i} out of range for max ${max}`);
            counts[i] += 1;
        });
        const expected = limit / max;
        assert.ok(
            counts.every((c) => c === expected),
            `max=${max} produced an uneven distribution: ${counts.join(',')}`,
        );
    }
});

test('an exhausted pool reports failure instead of padding or reusing bytes', () => {
    // Returning a short draw, or wrapping around, would silently reduce the entropy of a
    // generated passphrase. The caller must fetch more randomness instead.
    assert.equal(uniformIndicesFromBytes([1, 2, 3], 6, 256), null);

    // Rejection can exhaust a pool that looked long enough: with max=200 every one of these
    // bytes is discarded.
    assert.equal(uniformIndicesFromBytes([200, 210, 255, 249], 1, 200), null);
});

test('values that are not bytes are refused rather than folded into range', () => {
    for (const bad of [-1, 256, 1.5, Number.NaN]) {
        assert.throws(() => uniformIndicesFromBytes([bad], 1, 256), RangeError, `byte ${bad}`);
    }
});

test('an out-of-range list size is refused', () => {
    assert.throws(() => uniformIndicesFromBytes([0], 1, 0), RangeError);
    assert.throws(() => uniformIndicesFromBytes([0], 1, 257), RangeError);
});

test('a uniform byte source yields a flat word distribution (chi-square)', () => {
    // End-to-end over the real wordlist with a deterministic uniform source. A chi-square
    // statistic far above the critical value would mean the sampler skews toward part of
    // the list, which is exactly how a "random" passphrase quietly loses entropy.
    const draws = 256 * 40;
    const bytes = Array.from({ length: draws }, (_, i) => i % 256);
    const indices = uniformIndicesFromBytes(bytes, draws, WORDLIST.length)!;

    const counts = new Array(WORDLIST.length).fill(0);
    indices.forEach((i) => (counts[i] += 1));
    const expected = draws / WORDLIST.length;
    const chiSquare = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);

    // 255 degrees of freedom; the 99.9% critical value is ~331.
    assert.ok(chiSquare < 331, `chi-square ${chiSquare} suggests a skewed distribution`);
});

// ---------------------------------------------------------------- strength

test('generated phrases are rated far above self-chosen ones of the same length', () => {
    // Reporting these identically would tell the user their four remembered words are as
    // good as four random ones, which is the misleading claim worth avoiding.
    const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
    const generated = estimatePassphraseStrength(words, true);
    const chosen = estimatePassphraseStrength(words, false);

    assert.ok(generated.bits > chosen.bits);
    assert.equal(generated.bits, 48);
});

test('more words always means more entropy', () => {
    let previous = 0;
    for (let n = MIN_PASSPHRASE_WORDS; n <= MAX_PASSPHRASE_WORDS; n += 1) {
        const bits = estimatePassphraseStrength(WORDLIST.slice(0, n), true).bits;
        assert.ok(bits > previous, `${n} words should beat ${n - 1}`);
        previous = bits;
    }
});

test('a twelve-word generated phrase rates excellent', () => {
    const words = WORDLIST.slice(0, MAX_PASSPHRASE_WORDS);
    assert.equal(estimatePassphraseStrength(words, true).level, 'excellent');
});

test('repetition does not buy strength', () => {
    // A long password made of one repeated character must not score like a varied one.
    const repeated = estimatePasswordStrength('aaaaaaaaaaaaaaaaaaaaaaaa');
    const varied = estimatePasswordStrength('f7#Qm2!vLp9$Xb4&Zc1@Rt6*');

    assert.ok(varied.bits > repeated.bits * 2);
    assert.equal(repeated.level, 'weak');
});

test('empty input is weak, not an error', () => {
    assert.deepEqual(estimatePasswordStrength(''), { level: 'weak', bits: 0 });
    assert.deepEqual(estimatePassphraseStrength([], true), { level: 'weak', bits: 0 });
});

test('an obvious password cannot rate above weak however long it is', () => {
    const padded = `password${'!'.repeat(40)}`;
    assert.equal(estimatePasswordStrength(padded).level, 'weak');
});

// ---------------------------------------------------------------- formatting

test('the default filename is dated and uses the container extension', () => {
    assert.equal(
        defaultBackupFileName(new Date(2026, 7, 11)),
        `arsivinyo-backup-2026-08-11.${BACKUP_EXTENSION}`,
    );
    // Single-digit months and days must be padded, or files sort wrongly in a picker.
    assert.equal(
        defaultBackupFileName(new Date(2026, 0, 5)),
        `arsivinyo-backup-2026-01-05.${BACKUP_EXTENSION}`,
    );
});

test('byte sizes read sensibly across magnitudes', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1024), '1.0 KB');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(15 * 1024), '15 KB');
    assert.equal(formatBytes(5 * 1024 * 1024 * 1024), '5.0 GB');
});

test('negative or non-finite sizes do not produce nonsense', () => {
    assert.equal(formatBytes(-1), '0 B');
    assert.equal(formatBytes(Number.NaN), '0 B');
});

// ---------------------------------------------------------------- cross-language

test('section ids match the Kotlin container format', () => {
    // These are wire values written into every backup. If the two sides drift, a restore
    // silently skips whole sections rather than failing loudly.
    const kotlin = readFileSync(
        'modules/local-downloader/android/src/main/java/expo/modules/localdownloader/backup/BackupFormat.kt',
        'utf8',
    );
    for (const section of BACKUP_SECTIONS) {
        assert.match(
            kotlin,
            new RegExp(`const val SECTION_[A-Z]+ = "${section}"`),
            `Kotlin should declare section "${section}"`,
        );
    }

    const declared = [...kotlin.matchAll(/const val SECTION_[A-Z]+ = "([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(
        [...declared].sort(),
        [...BACKUP_SECTIONS].sort(),
        'Kotlin and TypeScript must declare the same sections',
    );
});

test('the file extension matches the Kotlin container format', () => {
    const kotlin = readFileSync(
        'modules/local-downloader/android/src/main/java/expo/modules/localdownloader/backup/BackupFormat.kt',
        'utf8',
    );
    assert.match(kotlin, new RegExp(`FILE_EXTENSION = "${BACKUP_EXTENSION}"`));
});

test('the default separator is one of the offered separators', () => {
    assert.ok(PASSPHRASE_SEPARATORS.includes(DEFAULT_SEPARATOR));
});
