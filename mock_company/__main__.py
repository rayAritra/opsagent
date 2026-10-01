"""Serve a single sandbox app."""

import argparse

import uvicorn

from mock_company.apps import create_app

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("app", choices=["portal", "erp", "mail"])
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    uvicorn.run(create_app(args.app), host="127.0.0.1", port=args.port)
