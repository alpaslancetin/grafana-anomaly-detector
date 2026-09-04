"""Exercise a real TLS proxy against an isolated exporter (writes QA rules).

Only run with a dedicated test exporter, never a production endpoint.
"""
import argparse
import json
import ssl
import time
import uuid
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--ca-file', required=True)
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    context = ssl.create_default_context(cafile=args.ca_file)
    uid = 'qa-proxy-' + uuid.uuid4().hex[:12]
    checks = []

    def request(path, method='GET', payload=None, expected=200, content_type='application/json'):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode() if payload is not None else None
        req = Request(base + path, data=body, method=method, headers={
            'Content-Type': content_type, 'Origin': base.rsplit('/anomalyalarm', 1)[0]})
        try:
            response = urlopen(req, context=context, timeout=20)
        except HTTPError as error:
            response = error
        with response:
            text = response.read().decode()
            assert response.status == expected, (path, response.status, text[:300])
            if path == '/metrics':
                assert 'grafana_anomaly_exporter_up 1' in text
                checks.append(f'{method} {path}: metrics')
                return text
            if method == 'OPTIONS':
                assert 'DELETE' in response.headers.get('Access-Control-Allow-Methods', '')
                checks.append(f'{method} {path}: preflight')
                return None
            assert 'application/json' in response.headers.get('Content-Type', ''), text[:200]
            result = json.loads(text)
            request_id = result['error']['requestId'] if expected >= 400 else result['requestId']
            assert request_id and response.headers.get('X-Request-ID') == request_id
            checks.append(f'{method} {path.split("?")[0]}: {expected}, JSON, request-id')
            return result

    deletion = '/api/sync/panel?' + urlencode({'dashboardUid': uid, 'panelId': 7})
    payload = {'dashboardUid': uid, 'dashboardTitle': 'Proxy QA', 'panelId': 7,
               'panelTitle': 'TLS prefix contract', 'target': 'prometheus',
               'syncHash': 'proxy-qa-v1', 'scopePolicy': 'saved', 'scopeHash': 'saved',
               'resolvedOptions': {'algorithm': 'mad', 'sensitivity': 4, 'baselineWindow': 12},
               'targets': [{'refId': 'A', 'expr': 'up', 'datasourceType': 'prometheus'}]}
    try:
        assert request('/api/capabilities')['basePath'] == '/anomalyalarm'
        for path in ('/health/live', '/health/ready', '/health/dependencies'):
            request(path)
        request('/metrics')
        request('/api/sync/panel', 'OPTIONS', expected=204)
        first = request('/api/sync/panel', 'POST', payload)
        assert first['status'] == 'created', first
        repeated = request('/api/sync/panel', 'POST', payload)
        assert repeated['status'] == 'unchanged' and repeated['revision'] == first['revision']
        rule_name = first['registered'][0]['rule']
        assert any(rule['dashboardUid'] == uid for rule in request('/api/sync/rules')['rules'])
        request('/api/sync/panel', 'POST', dict(payload, syncHash='changed', expectedRevision=first['revision'] + 1), expected=409)
        request('/api/sync/panel', 'POST', b'not-json', expected=400)
        request('/api/sync/panel', 'POST', b'{}', expected=415, content_type='text/plain')
        request('/api/feed/scores', 'POST', b'{' + b' ' * 1048576 + b'}', expected=413)
        request('/api/sync/panel?dashboardUid=' + uid + '&panelId=bad', 'DELETE', expected=400)
        request('/missing', expected=404)
        request('/api/feed/scores', 'POST', {
            'dashboardUid': uid, 'panelId': 7, 'target': 'prometheus', 'ruleName': rule_name,
            'rule': {'score': 95, 'timestamp': time.time(), 'isAnomaly': True},
            'series': [{'key': 'qa-series', 'label': 'Proxy QA', 'timestamp': time.time(),
                        'value': 143, 'expected': 100, 'lower': 80, 'upper': 120,
                        'rawScore': 3.6, 'normalizedScore': 95, 'isAnomaly': True}]})
        assert request(deletion, 'DELETE')['status'] == 'deleted'
        assert not any(rule['dashboardUid'] == uid for rule in request('/api/sync/rules')['rules'])
    finally:
        request(deletion, 'DELETE')
    print(json.dumps({'base': base, 'checks': checks, 'result': 'PASS'}, indent=2))


if __name__ == '__main__':
    main()
