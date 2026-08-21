# IRIS Benchmark Suite

IRIS exposes one benchmark entry point:

```bash
npm run benchmark
```

The command runs the complete local benchmark suite, prepares the fixed local Ollama models when
necessary, loads the existing production CLIP cache, records every result in a persistent benchmark
database, clears production-style workload rows, and overwrites two public exports:

```text
benchmark-results/
├── report.md
└── results.csv
```

There are no quick, list, live, or cloud-provider benchmark commands. The normal application never
imports the benchmark folder, so `npm run dev`, production builds, and packaged execution do not
start timers or collect benchmark data.

## Persistent benchmark storage

Benchmark history is stored in:

```text
~/.iris-ai/iris-benchmark.sqlite3
```

The database contains IRIS's normal encrypted application schema for real repository workloads
and a separate benchmark history schema. Production-style fixture rows are removed after each run;
run metadata, environment details, model setup, aggregate results, raw timing samples, lifecycle
events, and command outcomes remain available for historical comparison. The database file, schema,
indexes, model cache, and fixtures are retained between runs.

## Network and model policy

The runner installs a fetch guard before model preparation. Only loopback HTTP endpoints are
allowed, which permits the user's local Ollama service while blocking OpenAI, Anthropic, Gemini,
OpenRouter, search APIs, and every other remote provider endpoint. Provider adapters are measured
with local fixtures and a controlled loopback server only.

Missing Ollama models are pulled by asking the local Ollama service. CLIP uses IRIS's normal local
cache and actual Transformers.js/ONNX runtime; because non-loopback traffic is blocked, a missing CLIP
cache is reported clearly and must be prepared through IRIS before rerunning the suite.

## Current coverage

- AES-256-GCM buffers and encrypted JSON serialization
- Persistent encrypted SQLite startup, filesystem nodes, semantic vectors, and metadata
- Encrypted settings, chats, artifacts, skills, sub-agent output, and launcher-index repositories
- Filesystem traversal, DOCX extraction, PDF extraction, Sharp preprocessing, CLIP boundaries,
  video planning, semantic record construction, and concept clustering
- Real local CLIP processor, ONNX inference, and end-to-end batch sizes
- Real local Ollama MiniLM, launcher embedding, and analysis-model calls
- OpenAI, Anthropic, and Gemini local adapter conversion and parser work without remote requests
- Agent prompts, tool schemas, context estimation, Structured Task Protocol, and JSON recovery
- Validated loopback HTTP, bridge permissions, provider policy, header filtering, and launcher safety

Use the Markdown report for diagnosis and `results.csv` for sorting or importing the latest database
view. Historical comparisons should be queried from `iris-benchmark.sqlite3`, which is the source
of truth.
