/**
 * Extracts a small text sample from the first useful PDF pages. PDF.js reads local files
 * through a file-backed range transport, automatic prefetching is disabled, and page
 * extraction stops as soon as enough text exists.
 */

import fs from 'node:fs/promises';
import {
  getDocument,
  PDFDataRangeTransport,
  type PDFDocumentLoadingTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs';

const PDF_TARGET_CHARS = 2048;
const PDF_MAX_CHARS = 4096;
const PDF_MAX_PAGES = 8;
const PDF_RANGE_CHUNK_BYTES = 64 * 1024;
const PDF_PARSE_TIMEOUT_MS = 5_000;

export interface PdfTextResult {
  text: string;
  sourceType: 'pdf';
  extractionMethod: 'pdfjs-ranged-pages';
  pagesRead: number;
}

class FileRangeTransport extends PDFDataRangeTransport {
  private fileHandle: fs.FileHandle;
  private closed = false;

  constructor(fileHandle: fs.FileHandle, fileSize: number, initialData: Uint8Array) {
    super(fileSize, initialData, true);
    this.fileHandle = fileHandle;
    this.transportReady();
  }

  requestDataRange(begin: number, end: number): void {
    if (this.closed) return;
    const length = Math.max(0, end - begin);
    const buffer = Buffer.allocUnsafe(length);
    void this.fileHandle
      .read(buffer, 0, length, begin)
      .then(({ bytesRead }) => {
        if (this.closed) return;
        this.onDataRange(begin, Uint8Array.from(buffer.subarray(0, bytesRead)));
      })
      .catch(() => this.abort());
  }

  abort(): void {
    if (this.closed) return;
    this.closed = true;
    void this.fileHandle.close().catch(() => undefined);
  }
}

function abortError(): Error {
  const error = new Error('PDF extraction was cancelled');
  error.name = 'AbortError';
  return error;
}

function normalizePdfText(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasUsefulPdfText(value: string): boolean {
  return (value.match(/[\p{L}\p{N}]/gu)?.length || 0) >= 4;
}

function textItemValue(value: unknown): string {
  if (!value || typeof value !== 'object' || !('str' in value)) return '';
  return String((value as { str?: unknown }).str || '');
}

async function destroyLoadingTask(loadingTask: PDFDocumentLoadingTask | null): Promise<void> {
  await loadingTask?.destroy().catch(() => undefined);
}

async function openPdfRangeTransport(filePath: string): Promise<FileRangeTransport> {
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const fileStat = await fileHandle.stat();
    const initialLength = Math.min(fileStat.size, PDF_RANGE_CHUNK_BYTES);
    const initialBuffer = Buffer.allocUnsafe(initialLength);
    const { bytesRead } = await fileHandle.read(initialBuffer, 0, initialLength, 0);
    return new FileRangeTransport(
      fileHandle,
      fileStat.size,
      Uint8Array.from(initialBuffer.subarray(0, bytesRead)),
    );
  } catch (error) {
    await fileHandle.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Reads sequential pages until the small semantic-text target is reached. Large PDFs do not
 * process their remaining pages because range streaming and automatic prefetch are disabled.
 */
export async function extractPdfText(
  filePath: string,
  signal: AbortSignal,
): Promise<PdfTextResult | null> {
  if (signal.aborted) throw abortError();

  let loadingTask: PDFDocumentLoadingTask | null = null;
  let rangeTransport: FileRangeTransport | null = null;
  let timedOut = false;
  const cancel = () => {
    rangeTransport?.abort();
    void destroyLoadingTask(loadingTask);
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    cancel();
  }, PDF_PARSE_TIMEOUT_MS);
  signal.addEventListener('abort', cancel, { once: true });

  try {
    rangeTransport = await openPdfRangeTransport(filePath);
    if (signal.aborted) throw abortError();
    loadingTask = getDocument({
      range: rangeTransport,
      disableStream: true,
      disableAutoFetch: true,
      rangeChunkSize: PDF_RANGE_CHUNK_BYTES,
      useWorkerFetch: false,
      isEvalSupported: false,
      stopAtErrors: false,
      verbosity: 0,
    });
    const document = await loadingTask.promise;
    const parts: string[] = [];
    let characterCount = 0;
    let pagesRead = 0;
    const pageLimit = Math.min(document.numPages, PDF_MAX_PAGES);

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      if (signal.aborted) throw abortError();
      if (timedOut) return null;
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({
        includeMarkedContent: false,
      });
      const pageText = normalizePdfText(content.items.map(textItemValue).filter(Boolean).join(' '));
      page.cleanup();
      pagesRead += 1;

      if (pageText) {
        const remaining = PDF_MAX_CHARS - characterCount;
        if (remaining > 0) {
          const selected = pageText.slice(0, remaining);
          parts.push(selected);
          characterCount += selected.length;
        }
      }
      if (normalizePdfText(parts.join(' ')).length >= PDF_TARGET_CHARS) break;
      if (characterCount >= PDF_MAX_CHARS) break;
    }

    const text = normalizePdfText(parts.join(' '));
    if (!hasUsefulPdfText(text)) return null;
    return {
      text,
      sourceType: 'pdf',
      extractionMethod: 'pdfjs-ranged-pages',
      pagesRead,
    };
  } catch (error) {
    if (signal.aborted) throw abortError();
    if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
      return null;
    }
    return null;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
    rangeTransport?.abort();
    await destroyLoadingTask(loadingTask);
  }
}
