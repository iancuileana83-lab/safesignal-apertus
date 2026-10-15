# Hack Apertus, Track 2B. `make run` builds the image and starts SafeSignal on http://localhost:$(PORT).
# Model settings come from the environment (LLM_NAME, LLM_BASE_URL, LLM_API_KEY) or from a .env file.
# Without any model settings the app still starts and works in manual mode.
IMAGE ?= safesignal-apertus
PORT ?= 3000

.PHONY: run build test bench

run: build
	docker run --rm -p $(PORT):3000 $(if $(wildcard .env),--env-file .env,) -e LLM_NAME -e LLM_BASE_URL -e LLM_API_KEY -e BACKEND_KIND -e BACKEND_LABEL $(IMAGE)

build:
	docker build -t $(IMAGE) .

test:
	node --test src/test/*.test.mjs

bench:
	node --env-file-if-exists=.env src/tools/bench.mjs
