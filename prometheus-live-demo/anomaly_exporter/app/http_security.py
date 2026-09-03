from __future__ import annotations

import urllib.error
import urllib.request
from urllib.parse import urlparse


def _origin(url: str) -> tuple[str, str, int | None]:
    parsed = urlparse(url)
    return parsed.scheme.lower(), (parsed.hostname or '').lower(), parsed.port


class SameOriginRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Reject redirects that could escape a validated datasource origin."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ANN201
        if _origin(req.full_url) != _origin(newurl):
            raise urllib.error.HTTPError(newurl, 403, 'Cross-origin datasource redirect blocked', headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_same_origin(request: urllib.request.Request, timeout: int):
    return urllib.request.build_opener(SameOriginRedirectHandler()).open(request, timeout=timeout)
