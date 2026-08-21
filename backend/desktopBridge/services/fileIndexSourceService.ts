/**
 * Discovers mounted filesystem locations that can participate in the encrypted File Manager
 * index. Home is always present; Linux block and network mounts are classified with findmnt and
 * lsblk without mounting devices or following caller-provided paths.
 */

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readEncryptedFileIndexMeta } from '../storage/encryptedDatabase.js';
import { runProcess } from '../shared/processExecution.js';

const VIRTUAL_FILESYSTEM_TYPES = new Set([
  'autofs',
  'bpf',
  'cgroup',
  'cgroup2',
  'configfs',
  'debugfs',
  'devpts',
  'devtmpfs',
  'efivarfs',
  'fusectl',
  'hugetlbfs',
  'mqueue',
  'nsfs',
  'overlay',
  'proc',
  'pstore',
  'ramfs',
  'securityfs',
  'sysfs',
  'tmpfs',
  'tracefs',
]);
const NETWORK_FILESYSTEM_TYPES = new Set([
  '9p',
  'ceph',
  'cifs',
  'davfs',
  'fuse.sshfs',
  'glusterfs',
  'nfs',
  'nfs4',
  'smb3',
  'sshfs',
]);
const REMOVABLE_TRANSPORTS = new Set(['mmc', 'sdio', 'usb']);
const EXCLUDED_MOUNT_PATHS = new Set(['/boot', '/boot/efi', '/snap', '/var/lib/snapd/snap']);

export type FileIndexSourceKind = 'home' | 'internal' | 'removable' | 'network';

export interface FileIndexSource {
  id: string;
  label: string;
  path: string;
  kind: FileIndexSourceKind;
  filesystem: string;
  device: string;
  size: number;
  uuid: string;
  removable: boolean;
  network: boolean;
  readOnly: boolean;
  available: boolean;
  alwaysSelected: boolean;
  selectedByDefault: boolean;
}

interface FindmntEntry {
  target?: string;
  source?: string;
  fstype?: string;
  options?: string;
  size?: number | string;
  fsroot?: string;
  children?: FindmntEntry[];
}

interface LsblkEntry {
  path?: string;
  name?: string;
  type?: string;
  fstype?: string;
  size?: number | string;
  mountpoints?: Array<string | null> | string | null;
  rm?: boolean | number | string;
  ro?: boolean | number | string;
  tran?: string | null;
  uuid?: string | null;
  label?: string | null;
  children?: LsblkEntry[];
}

function flattenEntries<T extends { children?: T[] }>(entries: T[] = []): T[] {
  const result: T[] = [];
  const stack = [...entries];
  while (stack.length) {
    const entry = stack.shift();
    if (!entry) continue;
    result.push(entry);
    if (Array.isArray(entry.children)) stack.unshift(...entry.children);
  }
  return result;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function sourceId(uuid: string, mountPath: string, filesystemRoot: string): string {
  if (uuid) {
    const normalizedRoot = String(filesystemRoot || '').trim();
    if (normalizedRoot && normalizedRoot !== '/') {
      const rootFingerprint = createHash('sha256')
        .update(normalizedRoot)
        .digest('hex')
        .slice(0, 12);
      return `uuid:${uuid.toLowerCase()}:${rootFingerprint}`;
    }
    return `uuid:${uuid.toLowerCase()}`;
  }
  const fingerprint = createHash('sha256').update(mountPath).digest('hex').slice(0, 24);
  return `path:${fingerprint}`;
}

function mountLabel(entry: FindmntEntry, block: LsblkEntry | undefined, mountPath: string): string {
  const label = String(block?.label || '').trim();
  if (label) return label;
  const basename = path.basename(mountPath);
  if (basename && basename !== path.sep) return basename;
  return String(entry.source || block?.name || mountPath);
}

function filesystemIsNetwork(entry: FindmntEntry): boolean {
  const filesystem = String(entry.fstype || '').toLowerCase();
  const source = String(entry.source || '');
  return (
    NETWORK_FILESYSTEM_TYPES.has(filesystem) ||
    source.startsWith('//') ||
    (/^[^/]+:/.test(source) && !source.startsWith('/dev/'))
  );
}

function normalizeMountpoints(value: LsblkEntry['mountpoints']): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => Boolean(item));
  return value ? [String(value)] : [];
}

function mountPathIsExcluded(mountPath: string): boolean {
  return [...EXCLUDED_MOUNT_PATHS].some(
    (excludedPath) =>
      mountPath === excludedPath || mountPath.startsWith(`${excludedPath}${path.sep}`),
  );
}

async function pathIsReadableDirectory(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    if (!stats.isDirectory()) return false;
    await fs.access(targetPath, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function linuxMountSources(homePath: string): Promise<FileIndexSource[]> {
  let findmnt: FindmntEntry[] = [];
  let blocks: LsblkEntry[] = [];
  try {
    const result = await runProcess(
      'findmnt',
      ['--json', '--bytes', '--output', 'TARGET,SOURCE,FSTYPE,OPTIONS,SIZE,FSROOT'],
      { timeoutMs: 5000, maxBufferBytes: 4 * 1024 * 1024 },
    );
    findmnt = flattenEntries(
      (JSON.parse(result.stdout) as { filesystems?: FindmntEntry[] }).filesystems || [],
    );
  } catch {
    return [];
  }
  try {
    const result = await runProcess(
      'lsblk',
      [
        '--json',
        '--bytes',
        '--output',
        'PATH,NAME,TYPE,FSTYPE,SIZE,MOUNTPOINTS,RM,RO,TRAN,UUID,LABEL',
      ],
      { timeoutMs: 5000, maxBufferBytes: 4 * 1024 * 1024 },
    );
    blocks = flattenEntries(
      (JSON.parse(result.stdout) as { blockdevices?: LsblkEntry[] }).blockdevices || [],
    );
  } catch {
    blocks = [];
  }

  const blockBySource = new Map<string, LsblkEntry>();
  for (const block of blocks) {
    const devicePath = String(block.path || '').trim();
    if (devicePath) blockBySource.set(devicePath, block);
    for (const mountpoint of normalizeMountpoints(block.mountpoints)) {
      blockBySource.set(path.resolve(mountpoint), block);
    }
  }

  const canonicalHome = path.resolve(homePath);
  const seen = new Set<string>();
  const seenSourceIds = new Set<string>();
  const sources: FileIndexSource[] = [];
  for (const entry of findmnt) {
    const target = String(entry.target || '').trim();
    if (!target || !path.isAbsolute(target)) continue;
    const mountPath = path.resolve(target);
    const filesystem = String(entry.fstype || '').toLowerCase();
    if (!filesystem || VIRTUAL_FILESYSTEM_TYPES.has(filesystem)) continue;
    if (mountPath === path.parse(mountPath).root) continue;
    if (mountPathIsExcluded(mountPath)) continue;
    if (canonicalHome === mountPath || canonicalHome.startsWith(`${mountPath}${path.sep}`))
      continue;
    if (seen.has(mountPath) || !(await pathIsReadableDirectory(mountPath))) continue;

    const device = String(entry.source || '').trim();
    const block = blockBySource.get(device) || blockBySource.get(mountPath);
    const network = filesystemIsNetwork(entry);
    if (!network && !block) continue;
    const blockType = String(block?.type || '').toLowerCase();
    if (!network && blockType === 'loop') continue;
    const transport = String(block?.tran || '').toLowerCase();
    const removable =
      !network &&
      (blockType === 'rom' || booleanValue(block?.rm) || REMOVABLE_TRANSPORTS.has(transport));
    const readOnly =
      booleanValue(block?.ro) ||
      String(entry.options || '')
        .split(',')
        .includes('ro');
    const uuid = String(block?.uuid || '').trim();
    const kind: FileIndexSourceKind = network ? 'network' : removable ? 'removable' : 'internal';
    const id = sourceId(uuid, mountPath, String(entry.fsroot || ''));
    if (seenSourceIds.has(id)) continue;
    seen.add(mountPath);
    seenSourceIds.add(id);
    sources.push({
      id,
      label: mountLabel(entry, block, mountPath),
      path: mountPath,
      kind,
      filesystem: filesystem || String(block?.fstype || ''),
      device,
      size: Math.max(0, Number(entry.size || block?.size) || 0),
      uuid,
      removable,
      network,
      readOnly,
      available: true,
      alwaysSelected: false,
      selectedByDefault: kind === 'internal',
    });
  }
  return sources.sort((left, right) => left.label.localeCompare(right.label));
}

function normalizeStoredSource(value: unknown): FileIndexSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sourcePath = String(record.path || '').trim();
  const id = String(record.id || '').trim();
  if (!id || !path.isAbsolute(sourcePath)) return null;
  const kind = ['home', 'internal', 'removable', 'network'].includes(String(record.kind))
    ? (String(record.kind) as FileIndexSourceKind)
    : 'internal';
  return {
    id,
    label: String(record.label || path.basename(sourcePath) || sourcePath),
    path: path.resolve(sourcePath),
    kind,
    filesystem: String(record.filesystem || ''),
    device: String(record.device || ''),
    size: Math.max(0, Number(record.size) || 0),
    uuid: String(record.uuid || ''),
    removable: record.removable === true,
    network: record.network === true,
    readOnly: record.readOnly === true,
    available: record.available !== false,
    alwaysSelected: record.alwaysSelected === true || kind === 'home',
    selectedByDefault: record.selectedByDefault === true || kind === 'home' || kind === 'internal',
  };
}

export function fileIndexSourcesFromMeta(meta: Record<string, unknown> | null): FileIndexSource[] {
  const values = Array.isArray(meta?.sources) ? meta.sources : [];
  return values
    .map(normalizeStoredSource)
    .filter((source): source is FileIndexSource => Boolean(source));
}

/** Returns Home plus currently mounted, eligible filesystem locations. */
export async function discoverFileIndexSources(homePath: string): Promise<FileIndexSource[]> {
  const canonicalHome = await fs.realpath(homePath);
  const home: FileIndexSource = {
    id: 'home',
    label: 'Home',
    path: canonicalHome,
    kind: 'home',
    filesystem: '',
    device: '',
    size: 0,
    uuid: '',
    removable: false,
    network: false,
    readOnly: false,
    available: true,
    alwaysSelected: true,
    selectedByDefault: true,
  };
  const mounted = process.platform === 'linux' ? await linuxMountSources(canonicalHome) : [];
  return [home, ...mounted];
}

/** Resolves caller-selected IDs against fresh discovery and always retains Home. */
export async function resolveSelectedFileIndexSources(
  homePath: string,
  selectedIds: string[] = [],
): Promise<{ sources: FileIndexSource[]; discovered: FileIndexSource[] }> {
  const discovered = await discoverFileIndexSources(homePath);
  const requested = new Set(selectedIds.map((value) => String(value || '').trim()).filter(Boolean));
  const useDefaults = requested.size === 0;
  const sources = discovered.filter(
    (source) =>
      source.alwaysSelected ||
      requested.has(source.id) ||
      (useDefaults && source.selectedByDefault),
  );
  return { sources, discovered };
}

/** Returns selected roots from the completed index, falling back to Home only. */
export async function getFileIndexAccessRoots(homePath: string): Promise<string[]> {
  const [meta, discovered] = await Promise.all([
    readEncryptedFileIndexMeta(),
    discoverFileIndexSources(homePath),
  ]);
  const stored = fileIndexSourcesFromMeta(meta);
  const discoveredById = new Map(discovered.map((source) => [source.id, source]));
  const home = await fs.realpath(homePath);
  const candidates = stored.length
    ? [home, ...stored.map((source) => discoveredById.get(source.id)?.path || source.path)]
    : [home];
  const roots: string[] = [];
  for (const candidate of candidates) {
    try {
      const canonical = await fs.realpath(candidate);
      const stats = await fs.stat(canonical);
      if (stats.isDirectory()) roots.push(canonical);
    } catch {
      // A temporarily unavailable indexed drive must not break access to mounted locations.
    }
  }
  return [...new Set(roots)];
}

/** Combines fresh discovery with the locked source set from an existing index. */
export async function getFileIndexSourceState(homePath: string): Promise<{
  sources: FileIndexSource[];
  selectedSourceIds: string[];
  locked: boolean;
}> {
  const [discovered, meta] = await Promise.all([
    discoverFileIndexSources(homePath),
    readEncryptedFileIndexMeta(),
  ]);
  const stored = fileIndexSourcesFromMeta(meta);
  const locked = Boolean(meta && meta.status === 'complete' && stored.length);
  if (!locked) {
    return {
      sources: discovered,
      selectedSourceIds: discovered
        .filter((source) => source.selectedByDefault)
        .map((source) => source.id),
      locked: false,
    };
  }

  const discoveredById = new Map(discovered.map((source) => [source.id, source]));
  const selected = stored.map((source) => {
    const current = discoveredById.get(source.id);
    return current
      ? { ...source, ...current, available: current.available }
      : { ...source, available: false };
  });
  const selectedIds = new Set(selected.map((source) => source.id));
  return {
    sources: [...selected, ...discovered.filter((source) => !selectedIds.has(source.id))],
    selectedSourceIds: selected.map((source) => source.id),
    locked: true,
  };
}
