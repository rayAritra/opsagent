"""Serve the operator dashboard."""

import uvicorn

from dashboard.app import create_dashboard

if __name__ == "__main__":
    uvicorn.run(create_dashboard(), host="127.0.0.1", port=8000)
