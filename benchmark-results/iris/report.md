# Orbital Benchmark Report

This file is overwritten by every `npm run benchmark` execution. Historical results and raw samples remain in `~/.orbital-ai/orbital-benchmark.sqlite3`.

## Run summary

| Field                   | Value                                |
| ----------------------- | ------------------------------------ |
| Run ID                  | 3                                    |
| Run key                 | ae4a2a8a-73b3-4dd7-825e-427cb297dcb7 |
| Started                 | 2026-06-28T19:53:45.902Z             |
| Finished                | 2026-06-28T19:55:42.055Z             |
| Total duration          | 116.15 s                             |
| Passed                  | 82                                   |
| Failed                  | 0                                    |
| Skipped                 | 0                                    |
| Blocked remote requests | 0                                    |

## Environment

| Field        | Value                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| Platform     | linux 7.0.13-arch1-2 x64                                                                  |
| Host         | Jared-PC                                                                                  |
| CPU          | AMD Ryzen 9 3900X 12-Core Processor                                                       |
| Logical CPUs | 24                                                                                        |
| RAM          | 62.71 GiB                                                                                 |
| GPU          | 0, NVIDIA GeForce RTX 3090, 24576, 610.43.02 1, NVIDIA GeForce RTX 3090, 24576, 610.43.02 |
| Node         | v22.22.3                                                                                  |
| Electron     | not active in Node benchmark phase                                                        |
| SQLite       | 5.1.7                                                                                     |
| Sharp        | 0.34.5                                                                                    |
| FFmpeg       | ffmpeg version n8.1.2 Copyright (c) 2000-2026 the FFmpeg developers                       |
| Ollama       | ollama version is 0.30.10                                                                 |
| Commit       | ee44692c34fb                                                                              |
| Branch       | main                                                                                      |

## Local model setup

| Role                               | Model                        | Runtime         | Backend/device                 | Installed before | Downloaded | Setup/load |    Status | Details                                           |
| ---------------------------------- | ---------------------------- | --------------- | ------------------------------ | ---------------: | ---------: | ---------: | --------: | ------------------------------------------------- |
| file_text_embedding                | all-minilm:22m               | ollama          | ollama-loopback / local        |              yes |         no |          — | available | {}                                                |
| file_analysis_and_local_generation | qwen3-vl:4b-instruct         | ollama          | ollama-loopback / local        |              yes |         no |          — | available | {}                                                |
| launcher_embedding                 | qwen3-embedding:0.6b         | ollama          | ollama-loopback / local        |              yes |         no |          — | available | {}                                                |
| clip_image_and_text                | Xenova/clip-vit-base-patch32 | transformers.js | onnxruntime-node / cuda / fp16 |              yes |         no |     2.37 s | available | {"visionLaneCount":2,"visionDeviceIndices":[0,1]} |

## Slowest measured operations

| Rank | Benchmark                                            | Suite                    | Variant          |    Median |       p95 |    Throughput |  Previous run |
| ---: | ---------------------------------------------------- | ------------------------ | ---------------- | --------: | --------: | ------------: | ------------: |
|    1 | Local provider adapter and Ollama generation         | Real local models        | default          |    2.01 s |    2.02 s |    0.50 ops/s | +86.3% median |
|    2 | Ollama local analysis generation                     | Real local models        | default          |    1.85 s |    1.86 s |    0.54 ops/s | +82.8% median |
|    3 | CLIP image processor · batch 512                     | Real local models        | batch=512        |    1.75 s |    1.75 s |  295.64 ops/s |  +8.7% median |
|    4 | CLIP image processor · batch 256                     | Real local models        | batch=256        | 860.36 ms | 895.77 ms |  297.51 ops/s |  +7.3% median |
|    5 | Ollama launcher embedding · batch 32                 | Real local models        | batch=32         | 509.91 ms | 516.41 ms |   62.86 ops/s | -58.7% median |
|    6 | CLIP image processor · batch 128                     | Real local models        | batch=128        | 431.28 ms | 470.10 ms |  292.44 ops/s |  +2.3% median |
|    7 | CLIP prepared-image embedding · batch 512            | Real local models        | batch=512        | 379.19 ms | 385.84 ms | 1344.28 ops/s |  -0.6% median |
|    8 | CLIP vision inference · batch 512                    | Real local models        | batch=512        | 315.60 ms | 316.31 ms | 1621.03 ops/s |  -1.2% median |
|    9 | Ollama MiniLM embedding · batch 128                  | Real local models        | batch=128        | 279.65 ms | 282.78 ms |  458.14 ops/s |  +5.8% median |
|   10 | CLIP prepared-image embedding · batch 256            | Real local models        | batch=256        | 202.96 ms | 207.96 ms | 1259.43 ops/s |  +0.4% median |
|   11 | Text embedding to encrypted SQLite · 64 files        | Complete local pipelines | batch=64         | 167.07 ms | 174.73 ms |  379.87 ops/s | -15.9% median |
|   12 | Launcher query, decrypt, and rank · 256 applications | Complete local pipelines | applications=256 | 162.98 ms | 165.81 ms | 1573.66 ops/s |  -5.4% median |
|   13 | CLIP vision inference · batch 256                    | Real local models        | batch=256        | 158.37 ms | 158.39 ms | 1616.88 ops/s |  -0.9% median |
|   14 | Image preprocessing to encrypted SQLite · 32 images  | Complete local pipelines | batch=32         | 135.38 ms | 137.68 ms |  236.01 ops/s |  +2.3% median |
|   15 | Encrypted chat message append · 100                  | Application persistence  | default          | 133.09 ms | 139.67 ms |  742.07 ops/s |  -8.0% median |
|   16 | CLIP direct RGB tensor preparation · batch 512       | Real local models        | batch=512        | 116.42 ms | 120.57 ms | 4351.22 ops/s |  -9.0% median |
|   17 | CLIP prepared-image embedding · batch 128            | Real local models        | batch=128        | 114.12 ms | 115.05 ms | 1139.81 ops/s |  +8.7% median |
|   18 | Filesystem node batch upsert · 512 files             | Encrypted database       | default          | 111.29 ms | 114.74 ms | 4603.41 ops/s |  -8.7% median |
|   19 | CLIP image processor · batch 32                      | Real local models        | batch=32         | 105.57 ms | 115.74 ms |  298.23 ops/s |  -6.0% median |
|   20 | Ollama MiniLM embedding · batch 32                   | Real local models        | batch=32         | 100.54 ms | 103.52 ms |  318.69 ops/s |  +6.4% median |

## Cryptography

| Benchmark                   | Variant | Status |  Median |      p95 |    Ops/s | Peak RSS |  Previous run | Notes |
| --------------------------- | ------- | -----: | ------: | -------: | -------: | -------: | ------------: | ----- |
| AES-GCM round trip · 1 KiB  | default | passed | 9.89 ms | 19.95 ms | 17530.93 | 1.73 GiB |  +5.1% median |       |
| AES-GCM round trip · 64 KiB | default | passed | 2.40 ms |  6.37 ms |  7898.20 | 1.73 GiB |     unchanged |       |
| AES-GCM round trip · 1 MiB  | default | passed | 2.69 ms |  3.41 ms |  1079.06 | 1.73 GiB | -44.5% median |       |
| Encrypted JSON round trip   | default | passed | 5.48 ms | 10.80 ms |  7804.27 | 1.73 GiB |  -8.9% median |       |

## Encrypted database

| Benchmark                                  | Variant | Status |    Median |       p95 |    Ops/s | Peak RSS |  Previous run | Notes |
| ------------------------------------------ | ------- | -----: | --------: | --------: | -------: | -------: | ------------: | ----- |
| Persistent benchmark database reopen       | default | passed |   3.45 ms |   9.02 ms |   196.25 | 1.75 GiB | +70.8% median |       |
| Filesystem node batch upsert · 512 files   | default | passed | 111.29 ms | 114.74 ms |  4603.41 | 1.99 GiB |  -8.7% median |       |
| Semantic vector batch upsert · 64 vectors  | default | passed |   9.15 ms |  11.27 ms |  6828.95 | 1.99 GiB | -37.7% median |       |
| Semantic vector batch upsert · 512 vectors | default | passed |  62.55 ms |  68.89 ms |  7939.33 | 2.00 GiB | -59.6% median |       |
| Semantic vector read/decrypt · 512 vectors | default | passed |  42.48 ms |  44.22 ms | 12116.01 | 2.03 GiB |  -2.4% median |       |
| Filesystem tree read/decrypt · 512 files   | default | passed |  14.24 ms |  17.51 ms | 34735.38 | 2.04 GiB |  -6.9% median |       |
| Index metadata finalization                | default | passed |  20.38 ms |  25.65 ms |   954.73 | 2.04 GiB |  -5.9% median |       |

## Application persistence

| Benchmark                                              | Variant | Status |    Median |       p95 |    Ops/s | Peak RSS |  Previous run | Notes |
| ------------------------------------------------------ | ------- | -----: | --------: | --------: | -------: | -------: | ------------: | ----- |
| Encrypted durable settings writes · 100                | default | passed |  87.05 ms |  93.76 ms |  1143.92 | 2.04 GiB | -10.3% median |       |
| Encrypted durable settings hydration · 100             | default | passed |   4.52 ms |   4.58 ms | 22082.99 | 2.04 GiB |  -4.9% median |       |
| Encrypted chat message append · 100                    | default | passed | 133.09 ms | 139.67 ms |   742.07 | 2.04 GiB |  -8.0% median |       |
| Encrypted chat reconstruction · 200 messages           | default | passed |   5.33 ms |   8.12 ms | 33952.53 | 2.04 GiB | -19.0% median |       |
| Encrypted artifact round trip · 1 MiB                  | default | passed |  12.84 ms |  21.45 ms |    71.15 | 2.08 GiB |  -6.7% median |       |
| Encrypted sub-agent output round trip · 1 MiB          | default | passed |   7.38 ms |  16.46 ms |   106.74 | 1.98 GiB | -29.7% median |       |
| Encrypted skill upsert and list · 100                  | default | passed |  82.43 ms |  92.15 ms |  1203.84 | 1.97 GiB | -11.3% median |       |
| Encrypted launcher index round trip · 256 applications | default | passed |  84.23 ms |  87.36 ms |  3020.59 | 1.98 GiB | -13.2% median |       |

## Indexing stages

| Benchmark                                                | Variant | Status |   Median |      p95 |      Ops/s | Peak RSS |  Previous run | Notes |
| -------------------------------------------------------- | ------- | -----: | -------: | -------: | ---------: | -------: | ------------: | ----- |
| Stage 1 · Filesystem preflight scan                      | default | passed |  4.21 ms |  4.72 ms |     233.71 | 1.98 GiB |  -2.2% median |       |
| Stage 3 · DOCX streaming extraction                      | default | passed | 953.4 μs |  1.48 ms |    1003.90 | 1.98 GiB |  -2.2% median |       |
| Stage 4 · Searchable PDF extraction                      | default | passed |  2.21 ms |  3.40 ms |     418.40 | 1.98 GiB |  -3.4% median |       |
| Stage 5 · Sharp decode and CLIP resize                   | default | passed | 10.96 ms | 11.44 ms |      90.83 | 2.00 GiB |  -4.8% median |       |
| Stage 5 · CLIP RawImage wrapping · 512                   | default | passed |  83.8 μs | 129.5 μs | 6538514.34 | 2.00 GiB |  +7.1% median |       |
| Stage 5 · CLIP tensor conversion and normalization · 512 | default | passed |  4.07 ms |  6.82 ms |  112858.10 | 1.99 GiB | -15.8% median |       |
| Stage 5 · Image semantic record construction · 512       | default | passed | 114.3 μs | 147.3 μs | 4759507.01 | 1.99 GiB | -36.7% median |       |
| Stages 2–4 · Extracted-text semantic records · 512       | default | passed |  67.0 μs | 106.5 μs | 7745683.40 | 1.99 GiB | -19.2% median |       |
| Stage 6 · Long-video sampling plan                       | default | passed | 35.60 ms | 36.47 ms |   27982.65 | 1.99 GiB |  -5.3% median |       |
| Stage 6 · Video-frame semantic records · 96              | default | passed |  36.1 μs |  43.3 μs | 2564719.08 | 1.99 GiB | -13.3% median |       |
| Stage 7 · Spherical concept training                     | default | passed | 55.76 ms | 56.02 ms |   18353.62 | 1.99 GiB |  +0.7% median |       |

## Complete local pipelines

| Benchmark                                            | Variant          | Status |    Median |       p95 |   Ops/s | Peak RSS |  Previous run | Notes |
| ---------------------------------------------------- | ---------------- | -----: | --------: | --------: | ------: | -------: | ------------: | ----- |
| Text embedding to encrypted SQLite · 64 files        | batch=64         | passed | 167.07 ms | 174.73 ms |  379.87 | 2.00 GiB | -15.9% median |       |
| Image preprocessing to encrypted SQLite · 32 images  | batch=32         | passed | 135.38 ms | 137.68 ms |  236.01 | 2.54 GiB |  +2.3% median |       |
| Launcher query, decrypt, and rank · 256 applications | applications=256 | passed | 162.98 ms | 165.81 ms | 1573.66 | 2.54 GiB |  -5.4% median |       |

## Real local models

| Benchmark                                      | Variant   | Status |    Median |       p95 |   Ops/s | Peak RSS |  Previous run | Notes |
| ---------------------------------------------- | --------- | -----: | --------: | --------: | ------: | -------: | ------------: | ----- |
| CLIP image processor · batch 32                | batch=32  | passed | 105.57 ms | 115.74 ms |  298.23 | 2.77 GiB |  -6.0% median |       |
| CLIP direct RGB tensor preparation · batch 32  | batch=32  | passed |   8.41 ms |  10.65 ms | 3539.90 | 2.71 GiB |  -9.9% median |       |
| CLIP vision inference · batch 32               | batch=32  | passed |  20.98 ms |  24.38 ms | 1466.72 | 2.71 GiB |  +0.2% median |       |
| CLIP image processor · batch 128               | batch=128 | passed | 431.28 ms | 470.10 ms |  292.44 | 2.85 GiB |  +2.3% median |       |
| CLIP direct RGB tensor preparation · batch 128 | batch=128 | passed |  34.09 ms |  40.42 ms | 3663.98 | 3.07 GiB |  -3.4% median |       |
| CLIP vision inference · batch 128              | batch=128 | passed |  80.49 ms |  81.89 ms | 1585.56 | 2.86 GiB |  -0.3% median |       |
| CLIP image processor · batch 256               | batch=256 | passed | 860.36 ms | 895.77 ms |  297.51 | 3.15 GiB |  +7.3% median |       |
| CLIP direct RGB tensor preparation · batch 256 | batch=256 | passed |  61.41 ms |  67.87 ms | 4071.19 | 3.58 GiB |  -1.5% median |       |
| CLIP vision inference · batch 256              | batch=256 | passed | 158.37 ms | 158.39 ms | 1616.88 | 3.15 GiB |  -0.9% median |       |
| CLIP image processor · batch 512               | batch=512 | passed |    1.75 s |    1.75 s |  295.64 | 3.67 GiB |  +8.7% median |       |
| CLIP direct RGB tensor preparation · batch 512 | batch=512 | passed | 116.42 ms | 120.57 ms | 4351.22 | 4.26 GiB |  -9.0% median |       |
| CLIP vision inference · batch 512              | batch=512 | passed | 315.60 ms | 316.31 ms | 1621.03 | 3.69 GiB |  -1.2% median |       |
| CLIP prepared-image embedding · batch 32       | batch=32  | passed |  34.20 ms |  35.42 ms |  960.04 | 3.53 GiB |  -2.9% median |       |
| CLIP prepared-image embedding · batch 128      | batch=128 | passed | 114.12 ms | 115.05 ms | 1139.81 | 3.05 GiB |  +8.7% median |       |
| CLIP prepared-image embedding · batch 256      | batch=256 | passed | 202.96 ms | 207.96 ms | 1259.43 | 3.13 GiB |  +0.4% median |       |
| CLIP prepared-image embedding · batch 512      | batch=512 | passed | 379.19 ms | 385.84 ms | 1344.28 | 3.32 GiB |  -0.6% median |       |
| Ollama MiniLM embedding · batch 1              | batch=1   | passed |  40.03 ms |  41.81 ms |   24.93 | 3.38 GiB | +12.3% median |       |
| Ollama MiniLM embedding · batch 32             | batch=32  | passed | 100.54 ms | 103.52 ms |  318.69 | 3.10 GiB |  +6.4% median |       |
| Ollama MiniLM embedding · batch 128            | batch=128 | passed | 279.65 ms | 282.78 ms |  458.14 | 3.10 GiB |  +5.8% median |       |
| Ollama launcher embedding · batch 32           | batch=32  | passed | 509.91 ms | 516.41 ms |   62.86 | 3.10 GiB | -58.7% median |       |
| Ollama local analysis generation               | default   | passed |    1.85 s |    1.86 s |    0.54 | 3.02 GiB | +82.8% median |       |
| Local provider adapter and Ollama generation   | default   | passed |    2.01 s |    2.02 s |    0.50 | 3.02 GiB | +86.3% median |       |

## AI providers

| Benchmark                                     | Variant | Status |   Median |      p95 |      Ops/s | Peak RSS |  Previous run | Notes |
| --------------------------------------------- | ------- | -----: | -------: | -------: | ---------: | -------: | ------------: | ----- |
| OpenAI message normalization · 300 turns      | default | passed | 182.3 μs | 819.4 μs | 1034460.24 | 3.02 GiB |  +1.9% median |       |
| OpenAI request construction                   | default | passed | 172.0 μs | 523.9 μs |    5002.14 | 3.02 GiB |  -2.0% median |       |
| OpenAI stream delta parsing · 1,000 events    | default | passed | 742.9 μs |  1.17 ms | 1242754.89 | 3.02 GiB |  +0.8% median |       |
| OpenAI response normalization                 | default | passed | 947.0 μs |  1.42 ms |  516644.92 | 3.02 GiB | +18.5% median |       |
| Anthropic message normalization · 300 turns   | default | passed | 119.5 μs | 318.2 μs | 1934507.39 | 3.02 GiB | -12.7% median |       |
| Anthropic request construction                | default | passed | 103.0 μs | 779.3 μs |    4760.84 | 3.02 GiB | +28.1% median |       |
| Anthropic stream delta parsing · 1,000 events | default | passed | 795.8 μs |  1.80 ms | 1024230.84 | 3.02 GiB |  -5.5% median |       |
| Anthropic response normalization              | default | passed |  1.00 ms |  1.61 ms |  480148.48 | 3.02 GiB |  -3.7% median |       |
| Gemini content normalization · 300 turns      | default | passed | 146.9 μs | 463.5 μs | 1453692.53 | 3.02 GiB |  +5.0% median |       |
| Gemini request construction                   | default | passed |  84.3 μs | 436.1 μs |    6617.46 | 3.02 GiB | -40.9% median |       |
| Gemini response normalization                 | default | passed |  1.11 ms |  1.41 ms |  445270.66 | 3.02 GiB | +16.5% median |       |

## Agent runtime

| Benchmark                                     | Variant | Status |   Median |      p95 |      Ops/s | Peak RSS |  Previous run | Notes |
| --------------------------------------------- | ------- | -----: | -------: | -------: | ---------: | -------: | ------------: | ----- |
| Controller system prompt composition          | default | passed |  2.85 ms |  3.88 ms |  338785.15 | 3.03 GiB |  +4.6% median |       |
| Controller state-header composition           | default | passed | 897.9 μs |  1.65 ms |  967122.04 | 3.03 GiB | +12.2% median |       |
| Canonical tool schema conversion              | default | passed | 298.5 μs | 584.7 μs |  166035.64 | 3.03 GiB |  +6.4% median |       |
| Structured Task Protocol construction         | default | passed |  6.81 ms |  8.10 ms |   74275.05 | 3.03 GiB |  -1.5% median |       |
| Conversation token estimation · 200 turns     | default | passed |  26.9 μs |  55.9 μs | 6449680.72 | 3.03 GiB |  -0.3% median |       |
| Model capability and budget resolution        | default | passed |  2.49 ms |  3.14 ms |  386008.14 | 3.03 GiB |  +0.5% median |       |
| Controller JSON recovery · malformed wrappers | default | passed | 40.33 ms | 45.47 ms |   48582.88 | 3.04 GiB | +10.1% median |       |
| Sub-agent output JSON recovery                | default | passed |  7.86 ms |  9.83 ms |  242581.79 | 3.04 GiB |  +2.5% median |       |

## Network and safety

| Benchmark                                       | Variant | Status |   Median |      p95 |       Ops/s | Peak RSS |  Previous run | Notes |
| ----------------------------------------------- | ------- | -----: | -------: | -------: | ----------: | -------: | ------------: | ----- |
| Validated loopback API request · small JSON     | default | passed | 548.1 μs |  1.13 ms |     1514.22 | 3.04 GiB |  -8.5% median |       |
| Validated loopback API request · large JSON     | default | passed | 843.0 μs |  1.06 ms |     1132.02 | 3.04 GiB |  -3.5% median |       |
| Validated loopback API request · 100 chunks     | default | passed |  5.33 ms |  6.89 ms |      181.81 | 3.04 GiB |  -5.5% median |       |
| Provider proxy policy resolution                | default | passed |  4.78 ms |  4.83 ms |  1046205.03 | 3.04 GiB |  -9.2% median |       |
| Remote and provider header normalization        | default | passed | 10.11 ms | 10.58 ms |   491463.56 | 3.04 GiB |  -7.8% median |       |
| Bridge permission normalization and enforcement | default | passed | 316.4 μs | 618.8 μs | 26291103.51 | 3.04 GiB | -16.4% median |       |
| Launcher normalization and risk classification  | default | passed |  4.40 ms |  6.93 ms |  1005686.15 | 3.04 GiB |  -7.6% median |       |
| One-time launcher approval lifecycle            | default | passed |  2.38 ms |  3.02 ms |   404797.10 | 3.04 GiB |  +0.4% median |       |

## Incomplete or failed measurements

All benchmark cases completed successfully.

## Output contract

- This Markdown report and `results.csv` are exports of the latest completed run.
- Historical runs, environments, model details, aggregate results, and samples remain queryable in the benchmark database.
- Production-style benchmark rows are removed after the run; the database file, schema, fixtures, model cache, and retained benchmark history remain.
- Remote provider APIs are blocked. Real model measurements use only local CLIP and loopback Ollama.
