"""The process model: one master that holds the loaded graphs, forking worker processes that serve them.

Gunicorn with uvicorn's worker: ``preload_app`` makes the master hold the application (and with it every graph,
loaded once) before it forks the workers, so no worker loads a graph and every worker starts with them. Each worker
runs one search at a time (:py:class:`idtrack_web_api.limits.SearchSlot`): searches are CPU-bound, and threads add
no throughput (idtrack's measurements), so the server scales with workers.
"""

from __future__ import annotations

from typing import Any

from gunicorn.app.base import BaseApplication
from starlette.types import ASGIApp

from idtrack_web_api.config import Settings


class _Gunicorn(BaseApplication):  # type: ignore[misc]  # gunicorn has no type hints
    def __init__(self, application: ASGIApp, options: dict[str, Any]) -> None:
        self.options = options
        self.application = application
        super().__init__()

    def load_config(self) -> None:
        for key, value in self.options.items():
            self.cfg.set(key, value)

    def load(self) -> ASGIApp:
        return self.application


def gunicorn_options(settings: Settings) -> dict[str, Any]:
    """Return the options of the process model.

    Args:
        settings: The server's settings.

    Returns:
        dict[str, Any]: Gunicorn's settings.
    """
    return {
        "bind": f"{settings.host}:{settings.port}",
        "workers": settings.workers,
        "worker_class": "uvicorn_worker.UvicornWorker",
        "preload_app": True,
        # A worker that does not answer the master for this long is replaced; a search runs beside the event loop,
        # so the loop answers during a search, and this bound is only reached by a worker that is truly stuck.
        "timeout": int(settings.request_seconds) + 60,
        "graceful_timeout": int(settings.request_seconds) + 10,
        "keepalive": 5,
        "forwarded_allow_ips": ",".join(settings.forwarded_allow_ips),
        "accesslog": None,
        "errorlog": "-",
        "loglevel": settings.log_level.lower(),
        "proc_name": "idtrack-web",
        # No runtime control socket: the server is managed by its supervisor (compose, systemd), and the socket would
        # need a writable home folder.
        "control_socket_disable": True,
    }


def run(application: ASGIApp, settings: Settings) -> int:
    """Serve until stopped.

    Args:
        application: The application (graphs loaded).
        settings: The server's settings.

    Returns:
        int: The exit status.
    """
    _Gunicorn(application, gunicorn_options(settings)).run()
    return 0
