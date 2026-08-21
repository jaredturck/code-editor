/**
 * Exercises the observable tool catalog contract, with regression cases for “contains one
 * catalog entry for every canonical tool definition” and “returns defensive definition
 * arrays without cloning the stable entries”. The suite documents caller-visible behavior
 * so implementation refactors cannot silently weaken those guarantees.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOOL_TIMEOUT_MS,
  PERMISSION_TIER,
  TOOL_BY_NAME,
  TOOL_CATALOG,
  TOOL_DEFINITIONS,
  getSubAgentMinTier,
  getSubAgentNativeToolDefinitions,
  getToolCatalogEntry,
  getToolDefinitions,
  getToolPermissionKey,
  getToolPresentation,
  getToolTimeoutMs,
  isLeanTool,
  isToolRisky,
  normalizeToolAliasKey,
  resolveCatalogToolRequest,
} from '@/platform/agent/toolCatalog';

describe('toolCatalog', () => {
  it('contains one catalog entry for every canonical tool definition', () => {
    const names = TOOL_DEFINITIONS.map((tool) => tool.name);

    // launcher.list plus the model-mesh tools. cloud.consult remains as an explicit,
    // budgeted compatibility/policy operation even though cloud models also join the roster.
    expect(names).toHaveLength(59);
    expect(names).toContain('launcher.list');
    expect(names).toContain('rag.retrieve');
    expect(names).toContain('files.edit');
    expect(names).toContain('cloud.consult');
    expect(names).toContain('agent.find');
    expect(names).toContain('agent.consult');
    expect(names).toContain('agent.review');
    expect(names).toContain('agent.overwatch');
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(TOOL_CATALOG)).toEqual(names);
    expect(Object.keys(TOOL_BY_NAME)).toEqual(names);
  });

  it('returns defensive definition arrays without cloning the stable entries', () => {
    const first = getToolDefinitions();
    const second = getToolDefinitions();

    expect(first).not.toBe(second);
    expect(first[0]).toBe(second[0]);
    first.pop();
    expect(getToolDefinitions()).toHaveLength(second.length);
  });

  it('resolves exact, case-insensitive, and legacy alias names', () => {
    expect(resolveCatalogToolRequest('files.read')).toMatchObject({
      resolved: 'files.read',
      matchedBy: 'exact',
    });
    expect(resolveCatalogToolRequest('FILES.READ')).toMatchObject({
      resolved: 'files.read',
      matchedBy: 'case_insensitive',
    });
    expect(resolveCatalogToolRequest('read file')).toMatchObject({
      resolved: 'files.read',
      matchedBy: 'alias',
    });
    expect(resolveCatalogToolRequest('str_replace')).toMatchObject({
      resolved: 'files.edit',
      matchedBy: 'alias',
    });
    expect(resolveCatalogToolRequest('not-a-tool')).toMatchObject({
      resolved: '',
      matchedBy: 'none',
    });
    expect(normalizeToolAliasKey(' Read File! ')).toBe('read_file');
  });

  it('preserves the existing timeout policy', () => {
    expect(getToolTimeoutMs('terminal.exec')).toBe(90000);
    expect(getToolTimeoutMs('launch.run')).toBe(60000);
    expect(getToolTimeoutMs('search.web')).toBe(75000);
    expect(getToolTimeoutMs('rag.retrieve')).toBe(90000);
    expect(getToolTimeoutMs('files.patch')).toBe(30000);
    expect(getToolTimeoutMs('cloud.consult')).toBe(120000);
    expect(getToolTimeoutMs('notes.add')).toBe(15000);
    expect(getToolTimeoutMs('skills.search')).toBe(20000);
    expect(getToolTimeoutMs('unknown.tool')).toBe(DEFAULT_TOOL_TIMEOUT_MS);
  });

  it('preserves risk and permission metadata', () => {
    expect(isToolRisky('files.write')).toBe(true);
    expect(isToolRisky('terminal.exec')).toBe(true);
    expect(isToolRisky('files.read')).toBe(false);
    // files.patch writes files → it is risky AND gated by file_write (was an ungated hole).
    expect(isToolRisky('files.patch')).toBe(true);
    // files.edit (exact string replace) also writes files → risky + file_write.
    expect(isToolRisky('files.edit')).toBe(true);

    expect(getToolPermissionKey('files.read')).toBe('file_read');
    expect(getToolPermissionKey('rag.retrieve')).toBe('file_read');
    expect(getToolPermissionKey('files.write')).toBe('file_write');
    expect(getToolPermissionKey('launch.run')).toBe('terminal_exec');
    expect(getToolPermissionKey('files.patch')).toBe('file_write');
    expect(getToolPermissionKey('files.edit')).toBe('file_write');
  });

  it('preserves the lean tool surface', () => {
    expect(isLeanTool('terminal.exec')).toBe(true);
    expect(isLeanTool('files.patch')).toBe(true);
    expect(isLeanTool('files.edit')).toBe(true);
    expect(isLeanTool('rag.retrieve')).toBe(true);
    expect(isLeanTool('search.ripgrep')).toBe(false);
    expect(isLeanTool('files.stat')).toBe(false);
  });

  it('preserves sub-agent permission tiers', () => {
    expect(getSubAgentMinTier('notes.list')).toBe(PERMISSION_TIER.LOCKED);
    expect(getSubAgentMinTier('files.read')).toBe(PERMISSION_TIER.READ_ONLY);
    expect(getSubAgentMinTier('rag.retrieve')).toBe(PERMISSION_TIER.READ_ONLY);
    expect(getSubAgentMinTier('files.write')).toBe(PERMISSION_TIER.STANDARD);
    expect(getSubAgentMinTier('files.edit')).toBe(PERMISSION_TIER.STANDARD);
    expect(getSubAgentMinTier('unknown.tool')).toBe(PERMISSION_TIER.STANDARD);
  });

  it('exposes peer tools to every tier (sub-agents can ask for help)', () => {
    // LOCKED = available even to a read-only scout.
    expect(getSubAgentMinTier('agent.find')).toBe(PERMISSION_TIER.LOCKED);
    expect(getSubAgentMinTier('agent.consult')).toBe(PERMISSION_TIER.LOCKED);
    expect(getSubAgentMinTier('agent.review')).toBe(PERMISSION_TIER.LOCKED);
    // And the sub-agent runtime can build their schemas (they're native sub-agent defs now).
    const defs = getSubAgentNativeToolDefinitions(['agent.find', 'agent.consult', 'agent.review']);
    expect(defs.map((d) => d.name).sort()).toEqual(['agent.consult', 'agent.find', 'agent.review']);
  });

  it('builds only the existing native sub-agent schemas', () => {
    const definitions = getSubAgentNativeToolDefinitions(
      ['files.read', 'files.write', 'skills.list', 'search.web'],
      ['files.write'],
    );

    expect(definitions.map((tool) => tool.name)).toEqual(['files.read', 'search.web']);
    expect(definitions[0].args.lineCount).toContain('optional');
  });

  it('gives delegated sub-agents the file-edit, research, and skill tools', () => {
    const names = getSubAgentNativeToolDefinitions([
      'files.patch',
      'files.diff',
      'web.fetch',
      'launch.run',
      'skills.load',
      'skills.search',
    ]).map((tool) => tool.name);
    // files.patch was previously absent → no delegated executor could patch a file.
    expect(names).toEqual(
      expect.arrayContaining([
        'files.patch',
        'files.diff',
        'web.fetch',
        'launch.run',
        'skills.load',
        'skills.search',
      ]),
    );
    // Tier minimums: patch writes (STANDARD), skills are advisory (LOCKED → any tier).
    expect(getSubAgentMinTier('files.patch', PERMISSION_TIER.STANDARD)).toBe(
      PERMISSION_TIER.STANDARD,
    );
    expect(getSubAgentMinTier('skills.load', PERMISSION_TIER.STANDARD)).toBe(
      PERMISSION_TIER.LOCKED,
    );
  });

  it('provides stable UI presentation metadata', () => {
    expect(getToolPresentation('terminal.exec')).toMatchObject({
      kind: 'command',
      icon: 'command',
      moduleIcon: 'terminal',
    });
    expect(getToolPresentation('files.write')).toMatchObject({
      kind: 'edit',
      icon: 'edit',
      moduleIcon: 'files',
    });
    expect(getToolPresentation('files.edit')).toMatchObject({
      kind: 'edit',
      icon: 'edit',
      actionVerb: 'Edited',
    });
    expect(getToolPresentation('files.read')).toMatchObject({
      kind: 'read',
      icon: 'fileText',
      actionVerb: 'Read',
    });
    expect(getToolPresentation('search.web')).toMatchObject({
      kind: 'search',
      icon: 'search',
    });
    expect(getToolPresentation('notes.add')).toMatchObject({
      kind: 'other',
      moduleIcon: 'notes',
    });
  });

  it('exposes enriched catalog entries without changing runtime definitions', () => {
    const entry = getToolCatalogEntry('files.read');

    expect(entry).toMatchObject({
      name: 'files.read',
      module: 'Files',
      permissionKey: 'file_read',
      timeoutMs: 30000,
      lean: true,
      subAgentMinTier: PERMISSION_TIER.READ_ONLY,
      subAgentNative: true,
    });
    expect(entry?.aliases).toContain('read_file');
    expect(getToolCatalogEntry('missing')).toBeNull();
  });
});
