"""Validated runtime contracts and supported verification adapters."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Criterion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: Literal["payable", "no_duplicate", "vendor_contact", "overdue_email", "unchanged"]
    description: str
    target: str = ""


class TaskSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    outcome: str
    task_type: str
    inputs_needed: list[str]
    constraints: list[str]
    success_criteria: list[Criterion] = Field(min_length=1)
    clarification: str = ""


class PlanStep(BaseModel):
    intent: str
    status: Literal["pending", "active", "done", "blocked"] = "pending"


class Plan(BaseModel):
    steps: list[PlanStep] = Field(min_length=1)


class Judgement(BaseModel):
    satisfied: bool
    explanation: str


class Lesson(BaseModel):
    lesson: str
