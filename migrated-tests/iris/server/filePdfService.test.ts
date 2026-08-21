import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractPdfText } from '../../server/desktopBridge/services/filePdfService';
import { pdfFixture } from '../fixtures/documentFixtures';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true })));
});

describe('filePdfService', () => {
  it('extracts only the searchable page text from an extensionless PDF', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-pdf-'));
    temporaryRoots.push(root);
    const filePath = path.join(root, 'report.binary');
    await fs.writeFile(filePath, pdfFixture('PDF indexing stage phrase'));

    const result = await extractPdfText(filePath, new AbortController().signal);

    expect(result).toMatchObject({
      sourceType: 'pdf',
      extractionMethod: 'pdfjs-ranged-pages',
      pagesRead: 1,
    });
    expect(result?.text).toContain('PDF indexing stage phrase');
  });
});
