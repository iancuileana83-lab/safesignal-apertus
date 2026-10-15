# About these result files

`*-gateway.json` / `*-gateway.md` were produced by `src/tools/bench.mjs` against the Public AI gateway with
`swiss-ai/apertus-v1.5-70b` (the 8B v1.5 id is listed by the gateway but returned HTTP 404 on 2026-10-15).

**Quality columns are valid. Latency and throughput columns in the files from 2026-10-15 are not:**

- The gateway caches identical requests: a repeated request returns the same completion id in about 200 ms.
  The repeat pass and the throughput phase reuse the same samples, so most latencies there are cache hits.
- On the free tier, concurrent requests (concurrency 2 and 4) were answered with HTTP 429, so those rows show
  0 reports/s and all requests failed.
- Fresh single-request latency was observed separately: 8.4 s, 9.0 s and 9.5 s for three new extractions
  (about 950 prompt tokens, 500 to 540 completion tokens, 57 to 60 tokens/s).

The raw files are left unedited. The benchmark was changed afterwards to count latency from the first pass only
and to print this caveat.
