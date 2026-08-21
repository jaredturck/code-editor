/** Covers the stable semantic selectors used inside the hidden DuckDuckGo Chromium window. */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

interface ParserModule {
  buildDuckDuckGoSearchUrl: (request: {
    query: string;
    maxResults: number;
    safeSearch: string;
    timeRange: string;
    locale: string;
    region: string;
  }) => string;
  extractDuckDuckGoPage: (
    maxResults: number,
    timeoutMs: number,
  ) => Promise<Record<string, any>>;
  resolveDuckDuckGoSearchMode: (value: unknown) => string;
}

function loadParserModule(): ParserModule {
  const filename = path.resolve("electron-src/duckDuckGoPageParser.cts");
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
  return module.exports as unknown as ParserModule;
}

const parser = loadParserModule();

afterEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
});

describe("DuckDuckGo page parser", () => {
  it("builds the normal web URL from Orbital search settings", () => {
    const url = new URL(
      parser.buildDuckDuckGoSearchUrl({
        query: "what is a cat",
        maxResults: 8,
        safeSearch: "strict",
        timeRange: "week",
        locale: "en-gb",
        region: "uk-en",
      }),
    );

    expect(url.origin).toBe("https://duckduckgo.com");
    expect(url.searchParams.get("q")).toBe("what is a cat");
    expect(url.searchParams.get("ia")).toBe("web");
    expect(url.searchParams.get("kl")).toBe("uk-en");
    expect(url.searchParams.get("kp")).toBe("1");
    expect(url.searchParams.get("df")).toBe("w");
    expect(parser.resolveDuckDuckGoSearchMode("unknown")).toBe("browser");
  });

  it("extracts organic cards and ignores adverts without relying on generated classes", async () => {
    document.body.innerHTML = `
      <section data-testid="mainline">
        <ol>
          <li data-layout="ad">
            <article data-testid="ad" data-nrn="result">
              <h2><a data-testid="result-title-a" href="https://ads.example/">Advert</a></h2>
              <div data-result="snippet">Sponsored content</div>
            </article>
          </li>
          <li data-layout="organic">
            <article data-testid="result" data-nrn="result">
              <a data-testid="result-extras-url-link" href="https://en.wikipedia.org/wiki/Cat">Wikipedia</a>
              <h2><a data-testid="result-title-a" href="https://en.wikipedia.org/wiki/Cat">Cat - Wikipedia</a></h2>
              <div data-result="snippet">The <b>cat</b> is a small domesticated carnivorous mammal.</div>
            </article>
          </li>
          <li data-layout="organic">
            <article data-testid="result" data-nrn="result">
              <h2><a data-testid="result-title-a" href="https://www.britannica.com/animal/cat">Cat | Britannica</a></h2>
              <div data-result="snippet">A domesticated member of the family Felidae.</div>
            </article>
          </li>
        </ol>
        <div data-testid="related-searches"><a data-testid="related-search" href="/?q=domestic+cat">domestic cat</a></div>
      </section>
    `;

    const result = await parser.extractDuckDuckGoPage(8, 1000);

    expect(result.challenge).toBe(false);
    expect(result.results).toEqual([
      {
        title: "Cat - Wikipedia",
        url: "https://en.wikipedia.org/wiki/Cat",
        hostname: "en.wikipedia.org",
        snippet: "The cat is a small domesticated carnivorous mammal.",
      },
      {
        title: "Cat | Britannica",
        url: "https://www.britannica.com/animal/cat",
        hostname: "www.britannica.com",
        snippet: "A domesticated member of the family Felidae.",
      },
    ]);
    expect(result.relatedQueries).toEqual(["domestic cat"]);
  });

  it("recognizes DuckDuckGo browser challenge pages", async () => {
    document.body.innerHTML =
      "<main>Unfortunately, bots use DuckDuckGo too.</main>";
    Object.defineProperty(document.body, "innerText", {
      configurable: true,
      value: "Unfortunately, bots use DuckDuckGo too.",
    });

    await expect(parser.extractDuckDuckGoPage(8, 1000)).resolves.toMatchObject({
      challenge: true,
    });
  });
});
