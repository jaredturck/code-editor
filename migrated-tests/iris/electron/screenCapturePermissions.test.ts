import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

interface PermissionModule {
  decideScreenCapturePermissionCheck: (input: {
    trusted: boolean;
    permission: string;
    mediaType?: string;
    microphoneAllowed: boolean;
  }) => boolean;
  decideScreenCapturePermissionRequest: (input: {
    trusted: boolean;
    permission: string;
    mediaTypes?: string[];
    microphoneAllowed: boolean;
  }) => boolean;
}

function loadPermissionModule(): PermissionModule {
  const filename = path.resolve("electron-src/screenCapturePermissions.cts");
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const execute = new Function("exports", "module", "require", compiled);
  execute(module.exports, module, require);
  return module.exports as unknown as PermissionModule;
}

const permissions = loadPermissionModule();

describe("screen capture permission decisions", () => {
  it("allows trusted preliminary display checks reported as unknown or video", () => {
    for (const mediaType of ["unknown", "video", ""]) {
      expect(
        permissions.decideScreenCapturePermissionCheck({
          trusted: true,
          permission: "media",
          mediaType,
          microphoneAllowed: false,
        }),
      ).toBe(true);
    }
  });

  it("continues to gate microphone checks through the microphone permission", () => {
    expect(
      permissions.decideScreenCapturePermissionCheck({
        trusted: true,
        permission: "media",
        mediaType: "audio",
        microphoneAllowed: false,
      }),
    ).toBe(false);
    expect(
      permissions.decideScreenCapturePermissionCheck({
        trusted: true,
        permission: "media",
        mediaType: "audio",
        microphoneAllowed: true,
      }),
    ).toBe(true);
  });

  it("allows trusted display requests with empty or video media details", () => {
    expect(
      permissions.decideScreenCapturePermissionRequest({
        trusted: true,
        permission: "media",
        mediaTypes: [],
        microphoneAllowed: false,
      }),
    ).toBe(true);
    expect(
      permissions.decideScreenCapturePermissionRequest({
        trusted: true,
        permission: "media",
        mediaTypes: ["video"],
        microphoneAllowed: false,
      }),
    ).toBe(true);
    expect(
      permissions.decideScreenCapturePermissionRequest({
        trusted: true,
        permission: "display-capture",
        microphoneAllowed: false,
      }),
    ).toBe(true);
  });

  it("rejects every permission from an untrusted renderer", () => {
    expect(
      permissions.decideScreenCapturePermissionCheck({
        trusted: false,
        permission: "media",
        mediaType: "unknown",
        microphoneAllowed: true,
      }),
    ).toBe(false);
    expect(
      permissions.decideScreenCapturePermissionRequest({
        trusted: false,
        permission: "display-capture",
        microphoneAllowed: true,
      }),
    ).toBe(false);
  });

  it("keeps Electron on one standard screen-and-window portal request", () => {
    const source = fs.readFileSync(
      path.resolve("electron-src/orbWindow.cts"),
      "utf8",
    );
    expect(source).toContain("types: ['screen', 'window']");
    expect(source).not.toMatch(
      /setDisplayMediaRequestHandler\([^)]*useSystemPicker/s,
    );
  });
});
