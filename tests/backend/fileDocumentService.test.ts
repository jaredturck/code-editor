import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractDocumentText } from '../../backend/desktopBridge/services/fileDocumentService'
import {
  docxFixture,
  genericZipFixture,
  odpFixture,
  odsFixture,
  odtFixture,
  pptxFixture,
  xlsxFixture,
} from '../fixtures/documentFixtures'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true })))
})

describe('fileDocumentService', () => {
  it.each([
    [docxFixture('Word document search phrase'), 'docx', 'streaming-docx', 'Word document search phrase'],
    [xlsxFixture('Spreadsheet search phrase'), 'xlsx', 'streaming-xlsx', 'Spreadsheet search phrase'],
    [pptxFixture('Presentation search phrase'), 'pptx', 'streaming-pptx', 'Presentation search phrase'],
    [odtFixture('Open text search phrase'), 'odt', 'streaming-odf', 'Open text search phrase'],
    [odsFixture('Open sheet search phrase'), 'ods', 'streaming-odf', 'Open sheet search phrase'],
    [odpFixture('Open slides search phrase'), 'odp', 'streaming-odf', 'Open slides search phrase'],
  ])(
    'extracts extensionless office packages using content detection',
    async (buffer, sourceType, extractionMethod, expectedText) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-document-'))
      temporaryRoots.push(root)
      const filePath = path.join(root, 'misleading.binary')
      await fs.writeFile(filePath, buffer)

      const result = await extractDocumentText(filePath, new AbortController().signal)

      expect(result).toMatchObject({
        sourceType,
        extractionMethod,
      })
      expect(result?.text).toContain(expectedText)
    },
  )

  it('falls back to one text-like entry for an ordinary ZIP', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-document-zip-'))
    temporaryRoots.push(root)
    const filePath = path.join(root, 'source-bundle')
    await fs.writeFile(
      filePath,
      genericZipFixture({
        'assets/data.bin': Buffer.from([0, 1, 2, 3]),
        README: 'Generic archive fallback should index this readable project description.',
      }),
    )

    const result = await extractDocumentText(filePath, new AbortController().signal)

    expect(result).toMatchObject({
      sourceType: 'zip',
      extractionMethod: 'zip-fallback',
      archiveEntry: 'README',
    })
    expect(result?.text).toContain('readable project description')
  })
})
