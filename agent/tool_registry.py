"""One decorator defines implementation, schema and risk; all errors are structured."""

import inspect
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Callable

from pydantic import create_model


class Risk(StrEnum):
    READ = "READ"
    WRITE = "WRITE"
    EXTERNAL_SEND = "EXTERNAL_SEND"


class ToolFailure(Exception):
    """Classified operational error consumed by the tool boundary."""

    def __init__(self, kind: str, message: str) -> None:
        self.kind = kind
        super().__init__(message)


@dataclass
class Tool:
    name: str
    description: str
    risk: Risk
    implementation: Callable
    arguments: Any


REGISTRY: dict[str, Tool] = {}


def tool(risk: Risk = Risk.READ) -> Callable:
    """Register a typed function without ctx as a model-visible argument."""

    def register(fn: Callable) -> Callable:
        fields = {}
        for name, parameter in inspect.signature(fn).parameters.items():
            if name == "ctx":
                continue
            fields[name] = (
                parameter.annotation,
                ... if parameter.default is inspect.Parameter.empty else parameter.default,
            )
        model = create_model(f"{fn.__name__}_args", **fields)
        REGISTRY[fn.__name__] = Tool(fn.__name__, inspect.getdoc(fn) or "", risk, fn, model)
        return fn

    return register


def definitions() -> list[dict]:
    """Generate native Anthropic tool definitions from the registered functions."""
    return [
        {"name": t.name, "description": t.description, "input_schema": t.arguments.model_json_schema()}
        for t in REGISTRY.values()
    ]


async def invoke(ctx: Any, name: str, arguments: dict) -> dict:
    """Execute any tool and classify errors without raising into the agent loop."""
    from playwright.async_api import TimeoutError as BrowserTimeout
    from pydantic import ValidationError

    try:
        item = REGISTRY[name]
        values = item.arguments.model_validate(arguments).model_dump()
        result = item.implementation(ctx, **values)
        data = await result if inspect.isawaitable(result) else result
        return {"ok": True, "data": data, "error": None, "error_type": None}
    except ToolFailure as exc:
        return {"ok": False, "data": None, "error": str(exc), "error_type": exc.kind}
    except (BrowserTimeout, TimeoutError) as exc:
        return {"ok": False, "data": None, "error": str(exc).split("Call log:")[0], "error_type": "TRANSIENT"}
    except ValidationError as exc:
        return {"ok": False, "data": None, "error": str(exc), "error_type": "VALIDATION"}
    except PermissionError as exc:
        return {"ok": False, "data": None, "error": str(exc), "error_type": "PERMISSION_DENIED"}
    except Exception as exc:
        return {"ok": False, "data": None, "error": f"{type(exc).__name__}: {exc}", "error_type": "UNKNOWN"}
