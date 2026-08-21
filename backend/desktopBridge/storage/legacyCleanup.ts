/**
 * Removes former plaintext application-owned persistence after encrypted SQLite has
 * initialized successfully. The secure-storage architecture deliberately does not import
 * legacy plaintext state.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const LEGACY_DIRECTORIES = ['chats', 'store', 'subagent-tmp', 'artifacts', 'skills'];

export async function removeLegacyPlaintextStorage(databasePath: string): Promise<void> {
  const root = path.dirname(databasePath);
  for (const name of LEGACY_DIRECTORIES) {
    const target = path.join(root, name);
    await fs.rm(target, { recursive: true, force: true });
  }
}
