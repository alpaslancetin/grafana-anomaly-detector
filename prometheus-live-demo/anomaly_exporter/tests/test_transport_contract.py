from __future__ import annotations

import json
import os
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from app.http_security import SameOriginRedirectHandler
from app.models import AppConfig, GlobalConfig
from app.server import MetricsHandler


class StubRegistry:
    def health(self) -> dict[str, object]:
        return {'ready': True, 'error': '', 'activeRules': 0, 'schemaVersion': 3}


class StubRuntime:
    def __init__(self, config: GlobalConfig) -> None:
        self.current_config = AppConfig(global_config=config, rules=[], sinks={})
        self.dynamic_registry = StubRegistry()
        self.last_error = ''
        self.sink_manager = type('StubSinkManager', (), {'statuses': lambda self: []})()

    def read_metrics(self) -> bytes:
        return b'grafana_anomaly_exporter_up 1\n'

    def list_dynamic_rules(self) -> list[dict[str, object]]:
        return []

    def register_panel_sync(self, payload: dict[str, object]) -> dict[str, object]:
        return {'status': 'created', 'echo': payload}

    def ingest_score_feed(self, payload: dict[str, object]) -> dict[str, object]:
        return {'status': 'accepted', 'echo': payload}

    def delete_panel_sync(self, dashboard_uid: str, panel_id: int, scope_hash: str) -> dict[str, object]:
        return {'status': 'deleted', 'dashboardUid': dashboard_uid, 'panelId': panel_id, 'scopeHash': scope_hash}


class TransportContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = GlobalConfig(base_path='/anomalyalarm', max_request_body_bytes=128)
        MetricsHandler.runtime = StubRuntime(self.config)  # type: ignore[assignment]
        MetricsHandler._rate_windows = {}
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), MetricsHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        os.environ.pop('TEST_ANOMALY_API_TOKEN', None)

    def request(
        self,
        path: str,
        *,
        method: str = 'GET',
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        request = Request(f'{self.base}{path}', data=body, method=method, headers=headers or {})
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, dict(response.headers.items()), response.read()
        except HTTPError as exc:
            return exc.code, dict(exc.headers.items()), exc.read()

    def test_root_and_prefixed_routes_share_the_same_contract(self) -> None:
        for prefix in ('', '/anomalyalarm'):
            status, headers, body = self.request(f'{prefix}/api/capabilities')
            payload = json.loads(body)
            self.assertEqual(status, 200)
            self.assertEqual(payload['apiSchemaVersion'], 3)
            self.assertIn('idempotentSync', payload['features'])
            self.assertIn('decisionLifecycle', payload['features'])
            self.assertEqual(headers['X-Anomaly-Schema-Version'], '3')

            status, _, body = self.request(f'{prefix}/health/ready')
            self.assertEqual(status, 200)
            self.assertTrue(json.loads(body)['ready'])

    def test_unknown_and_invalid_requests_are_json(self) -> None:
        status, headers, body = self.request('/anomalyalarmx/api/sync/panel')
        self.assertEqual(status, 404)
        self.assertIn('application/json', headers['Content-Type'])
        self.assertEqual(json.loads(body)['error']['code'], 'route_not_found')

        status, _, body = self.request(
            '/api/sync/panel', method='POST', body=b'not-json', headers={'Content-Type': 'application/json'}
        )
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)['error']['code'], 'invalid_request')

        status, _, body = self.request('/api/sync/panel', method='POST', body=b'{}')
        self.assertEqual(status, 415)
        self.assertEqual(json.loads(body)['error']['code'], 'unsupported_media_type')

    def test_body_limit_token_and_origin_allowlist(self) -> None:
        status, _, body = self.request(
            '/api/feed/scores',
            method='POST',
            body=b'{' + (b' ' * 200) + b'}',
            headers={'Content-Type': 'application/json'},
        )
        self.assertEqual(status, 413)
        self.assertEqual(json.loads(body)['error']['code'], 'request_too_large')

        self.config.cors_allowed_origins = ['https://grafana.example.test']
        status, _, body = self.request('/api/capabilities', headers={'Origin': 'https://blocked.example.test'})
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)['error']['code'], 'origin_not_allowed')

        self.config.api_token_env = 'TEST_ANOMALY_API_TOKEN'
        os.environ['TEST_ANOMALY_API_TOKEN'] = 'secret-value'
        payload = json.dumps({'target': 'prometheus'}).encode()
        status, _, _ = self.request(
            '/api/feed/scores', method='POST', body=payload, headers={'Content-Type': 'application/json'}
        )
        self.assertEqual(status, 401)
        status, headers, body = self.request(
            '/api/feed/scores',
            method='POST',
            body=payload,
            headers={
                'Content-Type': 'application/json',
                'Authorization': 'Bearer secret-value',
                'Origin': 'https://grafana.example.test',
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'https://grafana.example.test')
        self.assertEqual(json.loads(body)['status'], 'accepted')

    def test_delete_contract_and_api_rate_limit(self) -> None:
        status, _, body = self.request(
            '/api/sync/panel?dashboardUid=demo&panelId=7&scopeHash=runtime-a', method='DELETE'
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['scopeHash'], 'runtime-a')

        self.config.api_rate_limit_per_minute = 1
        MetricsHandler._rate_windows = {}
        payload = json.dumps({'target': 'prometheus'}).encode()
        status, _, _ = self.request(
            '/api/feed/scores', method='POST', body=payload, headers={'Content-Type': 'application/json'}
        )
        self.assertEqual(status, 200)
        status, _, body = self.request(
            '/api/feed/scores', method='POST', body=payload, headers={'Content-Type': 'application/json'}
        )
        self.assertEqual(status, 429)
        self.assertEqual(json.loads(body)['error']['code'], 'rate_limited')

    def test_datasource_redirect_cannot_escape_validated_origin(self) -> None:
        request = Request('http://datasource.internal:8080/query')
        handler = SameOriginRedirectHandler()

        with self.assertRaises(HTTPError) as raised:
            handler.redirect_request(request, None, 302, 'Found', {}, 'http://metadata.internal/latest')

        self.assertEqual(raised.exception.code, 403)


if __name__ == '__main__':
    unittest.main()
