PYTHON ?= python
.PHONY: setup seed run test eval eval-chaos demo
setup:
	$(PYTHON) -m pip install -r requirements.lock.txt
	$(PYTHON) -m playwright install chromium
seed:
	$(PYTHON) seed.py
run:
	$(PYTHON) run_all.py
test:
	$(PYTHON) -m pytest -q
	$(PYTHON) -m ruff check .
eval:
	$(PYTHON) -m evals.run
eval-chaos:
	$(PYTHON) -m evals.run --chaos
demo:
	$(PYTHON) -m demos.run
