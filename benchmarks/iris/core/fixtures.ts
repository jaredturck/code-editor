/** Creates deterministic local fixtures used by filesystem, document, PDF, and image benchmarks. */

import fs from 'node:fs/promises';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';

const DEFAULT_FIXTURE_ROOT = path.join(
  process.env.HOME || process.cwd(),
  '.iris-ai',
  'benchmark-fixtures',
);

/** Returns one persistent fixture directory reused across benchmark runs. */
export async function createBenchmarkFixtureDirectory(label: string): Promise<string> {
  const root = path.join(DEFAULT_FIXTURE_ROOT, label.replace(/[^a-zA-Z0-9_-]/g, '-'));
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}

/** Builds a minimal DOCX package with enough repeated text to exercise streaming extraction. */
export function createDocxFixture(text = 'IRIS benchmark document content. '.repeat(100)): Buffer {
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      'word/document.xml': strToU8(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
      ),
    }),
  );
}

/** Builds a one-page searchable PDF without depending on external fixture files. */
export function createPdfFixture(text = 'IRIS benchmark searchable PDF content'): Buffer {
  const escaped = text.replace(/([()\\])/g, '\\$1');
  const content = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'binary'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'binary');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'binary');
}

/** Populates a bounded directory tree with text, binary, document, and PDF candidates. */
export async function createFilesystemFixture(
  options: {
    directories?: number;
    filesPerDirectory?: number;
  } = {},
): Promise<{ root: string; fileCount: number }> {
  const root = await createBenchmarkFixtureDirectory('filesystem');
  const directories = Math.max(1, options.directories ?? 20);
  const filesPerDirectory = Math.max(1, options.filesPerDirectory ?? 20);
  let fileCount = 0;
  for (let directoryIndex = 0; directoryIndex < directories; directoryIndex += 1) {
    const directory = path.join(root, `project-${String(directoryIndex).padStart(3, '0')}`);
    await fs.mkdir(directory, { recursive: true });
    const writes: Promise<void>[] = [];
    for (let fileIndex = 0; fileIndex < filesPerDirectory; fileIndex += 1) {
      const filename = path.join(directory, `file-${String(fileIndex).padStart(3, '0')}.txt`);
      writes.push(
        fs.writeFile(
          filename,
          `Project ${directoryIndex} file ${fileIndex}\n${'semantic indexing content '.repeat(20)}`,
          'utf8',
        ),
      );
      fileCount += 1;
    }
    await Promise.all(writes);
  }
  await Promise.all([
    fs.writeFile(path.join(root, 'sample.docx'), createDocxFixture()),
    fs.writeFile(path.join(root, 'sample.pdf'), createPdfFixture()),
    fs.writeFile(path.join(root, 'binary.bin'), Buffer.alloc(64 * 1024, 0xff)),
  ]);
  fileCount += 3;
  return { root, fileCount };
}

/** Retains stable fixture files so future runs measure the same inputs without regeneration churn. */
export async function retainBenchmarkFixture(_root: string): Promise<void> {
  // Persistent fixture data is intentionally kept between benchmark runs.
}
