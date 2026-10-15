# Technical report — `SafeSignal`

A deeper write-up than the README: what was built, how it works, and what the
numbers say.

- **Track:** `Track 2B — SafeSignal`
- **Event:** Online
- **Team:** `SafeSignal` — Ileana Mazilu (solo)
- **Demo:** `[ADD VIDEO URL]`

## 1. Summary

Incomplete side-effect reports are common: the medicine, dose, dates or outcome are missing, and the reporter has
to be asked again. SafeSignal sits at the moment of reporting. A person writes what happened in their own words,
in Romanian, English, German, French or Italian. Apertus 1.5 extracts patient, suspect medicine, reaction, dates
and outcome and must quote the words behind every field. Plain rules, not the model, then check completeness
against the minimum of a valid report and triage the urgency of the wording, showing a rule id for each reason.
A person edits the draft, confirms the review and downloads a structured report. Nothing is sent anywhere.
Headline result so far: the multilingual rule packs classify 15 of 15 text-only urgency samples correctly, against
10 of 15 for the English-only pack (section 5); model results are in section 5 once measured.

## 2. Architecture

```
free text (ro/en/de/fr/it)
   -> Apertus 1.5 (OpenAI-compatible /v1/chat/completions)
        fields + exact quote for each + report language + follow-up questions (JSON)
   -> validation: legal values only, quote must occur in the text (accent-insensitive)
   -> rules (no model): completeness, urgency with rule ids   <- red-flag packs en/ro/de/fr/it
   -> human edits and ticks "reviewed" -> structured JSON draft (never sent)
```

- **Server** (`src/server.mjs`): static files, `/api/status`, `/api/extract`. Zero npm dependencies, Node 22 in
  the container. Report text is neither logged nor stored. A small in-memory rate limit protects the model key.
- **Client** (`src/public/`): plain ES modules; the same `rules.js` runs in the browser, the server, the tests
  and the benchmark, so the checks are identical everywhere. UI in Romanian and English (`i18n.js`).
- **Model access** (`src/llm.mjs`): one OpenAI-compatible client; only `LLM_NAME`, `LLM_BASE_URL`,
  `LLM_API_KEY` change between endpoints. The key stays on the server.

### Target architecture (mandatory)

**Fits (a) on-premise and (b) air-gapped by design; not demonstrated in this submission. (c) is not claimed.**

- The application is one container with no runtime dependency except the model endpoint. Pointing
  `LLM_BASE_URL` at an Apertus weights server on the same host or network leaves no external connection at runtime.
- **What was actually run for the demo:** the hosted Public AI gateway (`https://api.publicai.co/v1`), which is
  an external hosted service and therefore *not* air-gapped or on-premise. The demo is honest about this: the
  page badge reads "Public AI gateway (hosted)".
- **Not done:** serving Apertus weights locally (no GPU was available in the build window), so latency, memory
  and quality of a local deployment are unmeasured. `[FILL IF DONE: local run details]`
- **External dependencies.** Build time: Docker base image `node:22-alpine`. Runtime: the model endpoint only.
  There are no npm packages.

## 3. Use of Apertus

- **Model:** `swiss-ai/apertus-v1.5-8b` through the Public AI gateway. `[CONFIRM exact id with GET /v1/models]`
- **How it is used:** inference only, one call per report. No fine-tuning, adapters or quantisation by us.
- **Where it runs:** hosted by the Public AI inference utility (see section 2).
- **Prompt** (`src/llm.mjs`, `buildPrompt`): the report is wrapped between `<<<REPORT_TEXT` markers and declared
  to be data, never instructions. The model must return a single JSON object with, for each field, a `value` and an
  exact `quote` in the original language; enumerated fields take English values from a fixed list; free text stays
  in the language of the report; it also returns `language` (ISO 639-1), up to three follow-up questions and a
  one-sentence summary. Temperature 0, `response_format: json_object` with a retry without it if the server
  rejects it, one retry after HTTP 429/503, and a 60 s timeout.
- **Other models:** none. The development stand-in (`npm run standin`) is a regex script, not a model, and is
  labelled as such in the badge. No other open-weights model was used as a judge.
- **Why rules decide urgency:** a model asked to triage can be steered by text inside the report. Here the model
  only extracts; urgency comes from the rules, so the model cannot lower it. A Romanian and an English injection
  sample are part of the tests.

## 4. Data

- **Sample set:** 17 fictional reports in `data/cases.json` (8 English, 6 Romanian, 1 German, 1 French,
  1 Italian) with gold answers for medicine, sex, outcome and urgency. The English samples come from the original
  SafeSignal repository; the others were written for this project with the AI coding assistant. No real person,
  patient or product report was used. Released under CDLA-Permissive-2.0.
- **No personal data, no human-subject data, no scraped data.** The app tells users not to type real details.
- **Gold answers** were assigned when the samples were written, by the same people (author and assistant) who
  wrote the rules. They are a design check, not an independent reference standard.

## 5. Evaluation

Task: (a) urgency from wording alone, (b) field extraction. Metrics: exact match against the gold answer.
Everything below is produced by `make bench` (`src/tools/bench.mjs`); raw files are in `bench/results/`.

**5a. Rules baseline (measured, no model).** Urgency from the report text alone, English-only rule pack vs. all
five packs. Scored on the 15 samples whose gold urgency comes from wording alone (emergency or routine).

| Language | Samples | English-only pack correct | All packs correct |
|----------|---------|---------------------------|-------------------|
| English  | 6 | 6 | 6 |
| Romanian | 6 | 3 | 6 |
| German   | 1 | 0 | 1 |
| French   | 1 | 0 | 1 |
| Italian  | 1 | 1 | 1 |
| **All**  | 15 | **10** | **15** |

Reading it correctly: the English-only pack passes the *routine* samples trivially (nothing fires). On the
5 non-English *emergency* samples it catches 0 of 5; the multilingual packs catch 5 of 5. The patterns were written
by the same author who wrote the samples, so this shows the packs behave as designed, **not** clinical validity or
generalisation to unseen text.

**5b. Apertus extraction quality (measured through the gateway).**

| Setup | Metric | Result |
|-------|--------|--------|
| Baseline: empty form (no tool) | fields filled | 0% |
| Ours: Apertus 1.5 8B, all samples | JSON valid / medicine / sex / outcome / urgency / quotes found | `[PENDING bench]` |
| Ours: Romanian samples only | same | `[PENDING bench]` |
| Ours: report language detected | match with the sample language | `[PENDING bench]` |
| Latency per report (p50 / p95) | ms | `[PENDING bench]` |

## 6. Limitations

- Rules are keyword and pattern based, not clinical. They cannot understand negation ("no difficulty breathing")
  and will over-trigger there; this errs towards a human looking sooner, but it is a false alarm.
- The Romanian, German, French and Italian patterns and the Romanian interface texts were drafted with an AI
  coding assistant and **have not been reviewed by a clinical or native-speaker reviewer**.
  `[FILL: review status of the Romanian texts by the author]`
- Only 17 fictional samples; one German, one French, one Italian. Dialects, abbreviations, typing without
  diacritics and brand names are barely covered. Accent-insensitive matching helps with missing diacritics.
- The extraction quality of the 8B model on real, messy Romanian is unknown beyond the fictional set.
- The hosted gateway is a third party: availability and rate limits are not under our control, and report text
  leaves the machine in the demo configuration. The demo says not to enter real data.
- The public endpoint spends the owner's gateway credit; only a per-address rate limit protects it.
- No accessibility audit, no regulatory validation, no real-world use.

## 7. Reproducibility

- **Runtime:** Docker and `make`. Node 22 inside the image; Node 18+ if run without Docker.
- **Run:** `make run` from the repository root (it calls `track_2b/Makefile`). Settings come from the environment
  (`LLM_NAME`, `LLM_BASE_URL`, `LLM_API_KEY`) or `track_2b/.env`.
- **Tests:** `make -C track_2b test` (20 tests: rules, multilingual urgency, accent-insensitive grounding, config).
- **Benchmark:** `make -C track_2b bench`. Without a model endpoint it still produces the rules baseline.
- **Seeds:** none; temperature is 0, but a hosted model gives no determinism guarantee.
- **Commit:** `[FILL at submission: git rev-parse HEAD]`

## 8. Next steps

- Review of the Romanian (and other) patterns and texts by pharmacovigilance professionals; a larger, independently
  labelled multilingual set (published as a Hugging Face dataset).
- Negation handling and a model-assisted second opinion that can only *raise* urgency, never lower it.
- Serve Apertus 8B locally (vLLM or llama.cpp) and measure an air-gapped deployment end to end.
- Voice input for Romanian-speaking pharmacy staff; mapping the draft to a regulator's reporting format, still
  with a human before any submission.

## Origin and disclosure

- **Base application.** SafeSignal was first built for the AMD Developer Hackathon: ACT III with a different
  model (Gemma, planned on AMD Instinct hardware), in the separate repository
  <https://github.com/iancuileana83-lab/safesignal>. Its first commit is dated 2026-10-13, inside the Hack Apertus
  period (1–16 October 2026).
- **New in this repository:** Apertus 1.5 as the model; Romanian-first multilingual rule packs
  (en/ro/de/fr/it) with accent-insensitive matching; Romanian and English UI; report-language field; per-language
  quality and rules-baseline benchmark; Public AI gateway support (User-Agent, retry); Docker and `make run`;
  Apache-2.0 licence. **Removed:** the AMD replay and recording machinery and all AMD wording.
- **AI assistance.** The code, tests, rule patterns and texts were developed with an AI coding assistant
  (Claude Code) under the author's direction. The author is responsible for the submission.

## License

Creative Commons Attribution 4.0 (CC-BY-4.0). All HackApertus projects are open-sourced.

## References

- Hack Apertus project template and Track 2B README: <https://github.com/HackApertus/project-template>
- Public AI API documentation: <https://platform.publicai.co/docs>
- Apertus 1.5 models: <https://huggingface.co/swiss-ai/Apertus-v1.5-8B>
