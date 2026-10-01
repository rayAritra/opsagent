"""Central configuration; application addresses live only in config/apps.yaml."""

from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
APPS = yaml.safe_load((ROOT / "config" / "apps.yaml").read_text(encoding="utf-8-sig"))
POLICIES = yaml.safe_load((ROOT / "config" / "policies.yaml").read_text(encoding="utf-8-sig"))
DRIVE = ROOT / "mock_company" / "shared_drive"
RUNS = ROOT / "runs"

PROVIDERS = yaml.safe_load((ROOT / "config" / "providers.yaml").read_text(encoding="utf-8-sig"))
