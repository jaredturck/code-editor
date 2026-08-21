import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectOfficePackageType,
  extractGenericZipText,
  hasZipSignature,
} from '../../server/desktopBridge/services/fileArchiveService';
import {
  docxFixture,
  genericZipFixture,
  odpFixture,
  odsFixture,
  odtFixture,
  pptxFixture,
  xlsxFixture,
} from '../fixtures/documentFixtures';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true })));
});

describe('fileArchiveService', () => {
  it.each([
    [docxFixture(), 'docx'],
    [xlsxFixture(), 'xlsx'],
    [pptxFixture(), 'pptx'],
    [odtFixture(), 'odt'],
    [odsFixture(), 'ods'],
    [odpFixture(), 'odp'],
  ])('detects package type from archive contents', (buffer, expected) => {
    expect(hasZipSignature(buffer)).toBe(true);
    expect(detectOfficePackageType(buffer)).toBe(expected);
  });

  it('selects one shallow text-like entry from a generic archive', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-zip-'));
    temporaryRoots.push(root);
    const archivePath = path.join(root, 'archive-without-extension');
    await fs.writeFile(
      archivePath,
      genericZipFixture({
        'binary.dat': Buffer.from([0, 1, 2, 3, 4, 5]),
        'docs/readme':
          'This archive contains semantic indexing notes and useful project documentation.',
        'deep/path/ignored.txt': 'This deep file should not be inspected.',
      }),
    );

    const result = await extractGenericZipText(archivePath, new AbortController().signal);

    expect(result).toMatchObject({
      entryName: 'docs/readme',
    });
    expect(result?.text).toContain('semantic indexing notes');
    expect(result?.inspectedEntries).toBe(2);
  });

  it('inspects no more than twenty eligible entries', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-zip-limit-'));
    temporaryRoots.push(root);
    const archivePath = path.join(root, 'large-archive');
    const files = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [
        `file-${String(index).padStart(2, '0')}.txt`,
        `Readable archive text candidate number ${index} with several words.`,
      ]),
    );
    await fs.writeFile(archivePath, genericZipFixture(files));

    const result = await extractGenericZipText(archivePath, new AbortController().signal);

    expect(result?.inspectedEntries).toBe(20);
  });
});
