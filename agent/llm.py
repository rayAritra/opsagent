"""Small native-tool-calling provider abstraction; no agent framework or mock provider."""

import json
import os
from dataclasses import dataclass
from typing import Protocol

from dotenv import dotenv_values
from pydantic import BaseModel

from agent.config import PROVIDERS, ROOT


@dataclass
class Response:
    name: str
    arguments: dict
    text: str
    input_tokens: int
    output_tokens: int


class Provider(Protocol):
    async def call(
        self, system: str, messages: list[dict], tools: list[dict], force: str | None = None
    ) -> Response: ...


class AnthropicProvider:
    def __init__(self, key: str, model: str) -> None:
        from anthropic import AsyncAnthropic

        self.client = AsyncAnthropic(api_key=key, max_retries=2, timeout=60)
        self.model = model

    async def call(
        self, system: str, messages: list[dict], tools: list[dict], force: str | None = None
    ) -> Response:
        """Ask for one native tool call, preserving SDK token accounting."""
        choice = {"type": "tool", "name": force} if force else {"type": "any"}
        choice["disable_parallel_tool_use"] = True
        reply = await self.client.messages.create(
            model=self.model,
            max_tokens=2400,
            system=system,
            messages=messages,
            tools=tools,
            tool_choice=choice,
        )
        calls = [b for b in reply.content if b.type == "tool_use"]
        if len(calls) != 1:
            raise ValueError("Provider must return exactly one tool call.")
        text = " ".join(b.text for b in reply.content if b.type == "text")
        return Response(
            calls[0].name, calls[0].input, text, reply.usage.input_tokens, reply.usage.output_tokens
        )


class OpenAIProvider:
    def __init__(self, key: str, model: str, base_url: str) -> None:
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(api_key=key, base_url=base_url, max_retries=2, timeout=60)
        self.model = model

    async def call(
        self, system: str, messages: list[dict], tools: list[dict], force: str | None = None
    ) -> Response:
        """Translate the same registry to OpenAI-compatible function calling."""
        definitions = [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"],
                    "parameters": t["input_schema"],
                },
            }
            for t in tools
        ]
        reply = await self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "system", "content": system}, *messages],
            tools=definitions,
            tool_choice={"type": "function", "function": {"name": force}} if force else "required",
            parallel_tool_calls=False,
            max_tokens=2400,
        )
        message = reply.choices[0].message
        if len(message.tool_calls or []) != 1:
            raise ValueError("Provider must return exactly one tool call.")
        call = message.tool_calls[0].function
        return Response(
            call.name,
            json.loads(call.arguments),
            message.content or "",
            reply.usage.prompt_tokens if reply.usage else 0,
            reply.usage.completion_tokens if reply.usage else 0,
        )


def make_provider() -> Provider:
    """Load secrets only from local .env; reject missing credentials honestly."""
    env = dotenv_values(ROOT / ".env")
    provider = os.getenv("OPSAGENT_PROVIDER", "anthropic")
    key_name = "ANTHROPIC_API_KEY" if provider == "anthropic" else "OPENAI_API_KEY"
    key = env.get(key_name)
    if not key:
        raise RuntimeError(f"Live agent unavailable: set {key_name} in .env. No simulated agent is used.")
    if provider == "anthropic":
        return AnthropicProvider(key, os.getenv("OPSAGENT_MODEL", PROVIDERS["anthropic_model"]))
    if provider == "openai":
        return OpenAIProvider(
            key,
            os.getenv("OPSAGENT_MODEL", PROVIDERS["openai_model"]),
            os.getenv("OPENAI_BASE_URL", PROVIDERS["openai_base_url"]),
        )
    raise ValueError("OPSAGENT_PROVIDER must be anthropic or openai")


def structured_tool(name: str, model: type[BaseModel], description: str) -> dict:
    """Expose a Pydantic contract through native tool calling."""
    return {"name": name, "description": description, "input_schema": model.model_json_schema()}
