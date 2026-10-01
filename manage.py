"""Cross-platform equivalent of Make targets for systems without GNU Make."""

import argparse
import subprocess
import sys

COMMANDS = {
    "setup": [
        ["-m", "pip", "install", "-r", "requirements.lock.txt"],
        ["-m", "playwright", "install", "chromium"],
    ],
    "seed": [["seed.py"]],
    "run": [["run_all.py"]],
    "test": [["-m", "pytest", "-q"], ["-m", "ruff", "check", "."]],
    "eval": [["-m", "evals.run"]],
    "eval-chaos": [["-m", "evals.run", "--chaos"]],
    "demo": [["-m", "demos.run"]],
}


def main() -> None:
    """Execute the exact target commands with the current Python interpreter."""
    parser = argparse.ArgumentParser()
    parser.add_argument("target", choices=COMMANDS)
    args = parser.parse_args()
    for command in COMMANDS[args.target]:
        result = subprocess.run([sys.executable, *command])
        if result.returncode:
            raise SystemExit(result.returncode)


if __name__ == "__main__":
    main()
