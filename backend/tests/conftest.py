"""Test-host guards for the restricted Windows sandbox."""

import sys

import pytest


def pytest_collection_modifyitems(items):
    if sys.platform != "win32":
        return
    reason = "Windows sandbox blocks socket.socketpair/localhost sockets; async integration test skipped"
    skip_async = pytest.mark.skip(reason=reason)
    for item in items:
        uses_blocked_asyncio = item.fspath.basename == "test_paper_kill_switch_and_forecast.py" and "probabilistic_forecast" in item.name
        if item.get_closest_marker("anyio") is not None or uses_blocked_asyncio:
            item.add_marker(skip_async)
