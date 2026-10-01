"""Local sandbox credentials, resolved only inside the browser tool."""

CREDENTIALS = {f"{app}_creds": {"username": "demo", "password": "demo"} for app in ("portal", "erp", "mail")}


def resolve(text: str) -> str:
    """Substitute an opaque credential reference, never return secrets to the model."""
    if text.startswith("$"):
        alias, field = text[1:].split(".", 1)
        return CREDENTIALS[alias][field]
    return text
