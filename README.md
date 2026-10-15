# SafeSignal for Apertus

Hack Apertus, **Track 2B (Own Project)**. Team: **SafeSignal** (solo: Ileana Mazilu).

SafeSignal helps people and pharmacy staff report a **suspected medicine side effect** completely, in
**Romanian, English, German, French or Italian**. A person describes what happened in their own words.
**Apertus 1.5** extracts the facts and must quote the words behind every field. Plain, transparent rules
(not the model) then check what is missing and how urgent the wording looks. A person edits the structured draft
and downloads it. Nothing is sent anywhere.

> **Demo only. Fictional data. Not medical advice.** SafeSignal never diagnoses and has no send button.

The project lives in [`track_2b/`](track_2b/). Report: [`track_2b/technical_report.md`](track_2b/technical_report.md).

## Run it

Needs Docker and `make`.

```bash
cp track_2b/.env.example track_2b/.env     # then set LLM_API_KEY yourself
make run                                   # http://localhost:3000
```

`make run` takes the model settings from the environment or from `track_2b/.env`:

| Variable | Example |
|---|---|
| `LLM_NAME` | `swiss-ai/apertus-v1.5-8b` |
| `LLM_BASE_URL` | `https://api.publicai.co/v1` (Public AI gateway) or `http://<your-server>:8000/v1` |
| `LLM_API_KEY` | your key (never committed, never sent to the browser) |

Without any model settings the app still starts: the form and the completeness and urgency checks work by
hand, and the page says that no model is connected.

Without Docker: `cd track_2b && npm start` (Node 18+, no npm dependencies) and `npm test`.

## What is in it

- **Extraction:** one OpenAI-compatible call; the model returns each field with an exact quote. Quotes are
  checked against the text (accent-insensitive, so `ș`/`ş`, `ț`/`ţ`, `ă` do not break the check); fields whose
  quote is not found are flagged.
- **Rules in five languages:** completeness (the minimum of patient, reporter, medicine, reaction) and
  urgency (emergency wording, priority, routine), each reason shown with a rule id. A prompt injected into a
  report cannot lower the urgency, because the model does not set it.
- **Bilingual interface:** Romanian and English UI; reports can be in any of the five languages.
- **Human in the loop:** every field is editable and the report is a draft until a person ticks the review box.
- **No storage:** the server neither logs nor keeps report text.

## Sovereignty, honestly

The code has no external runtime dependency other than the model endpoint, and that endpoint is one URL. The
demo uses the hosted Public AI gateway. To run on-premise or air-gapped, point `LLM_BASE_URL` at an Apertus
weights server on the same machine or network. That path is **designed for but not demonstrated** in this
submission; see the technical report.

## Origin and disclosure

The base application (SafeSignal) was first built for the **AMD Developer Hackathon: ACT III** with a different
model (Gemma, planned on AMD hardware): <https://github.com/iancuileana83-lab/safesignal>. Its first commit is
dated 2026-10-13, inside the Hack Apertus period. This repository is a separate copy; what changed is listed in
the technical report. The code and the rule texts were written with an AI coding assistant (Claude Code), which
is disclosed in the report as well.

## Licence

Code: Apache-2.0 ([LICENSE](LICENSE)). Documentation: CC-BY-4.0. Sample data (`track_2b/data/`):
CDLA-Permissive-2.0.
