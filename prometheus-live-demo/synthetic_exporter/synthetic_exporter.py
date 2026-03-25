import math
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 9108


def wave(now: float, base: float, amplitude: float, period_seconds: float, phase: float = 0.0) -> float:
    return base + amplitude * math.sin(((now + phase) / period_seconds) * 2 * math.pi)


def spike(now: float, every_seconds: float, duration_seconds: float, amplitude: float, phase: float = 0.0) -> float:
    return amplitude if ((now + phase) % every_seconds) < duration_seconds else 0.0


def metric_snapshot(now: float) -> dict[str, float]:
    return {
        'demo_latency_ms{service="checkout",instance="api-1",environment="demo"}': wave(now, 245, 8, 180) + spike(now, 150, 18, 110),
        'demo_latency_ms{service="checkout",instance="api-2",environment="demo"}': wave(now, 228, 10, 210, phase=20) + spike(now, 190, 16, 75, phase=15),
        'demo_requests_per_second{service="checkout",instance="api-1",environment="demo"}': wave(now, 185, 12, 120) + spike(now, 150, 18, 48),
        'demo_requests_per_second{service="checkout",instance="api-2",environment="demo"}': wave(now, 172, 10, 140, phase=35) + spike(now, 190, 16, 30, phase=10),
        'demo_error_rate_percent{service="checkout",instance="api-1",environment="demo"}': wave(now, 1.4, 0.25, 160) + spike(now, 150, 18, 3.8),
        'demo_error_rate_percent{service="checkout",instance="api-2",environment="demo"}': wave(now, 1.1, 0.2, 175, phase=45) + spike(now, 190, 16, 2.1, phase=12),
    }


class MetricsHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path not in ('/metrics', '/'):
            self.send_response(404)
            self.end_headers()
            return

        now = time.time()
        values = metric_snapshot(now)
        payload = '\n'.join(
            [
                '# HELP demo_latency_ms Synthetic checkout latency in milliseconds.',
                '# TYPE demo_latency_ms gauge',
                f'demo_latency_ms{{service="checkout",instance="api-1",environment="demo"}} {values["demo_latency_ms{service=\"checkout\",instance=\"api-1\",environment=\"demo\"}"]:.4f}',
                f'demo_latency_ms{{service="checkout",instance="api-2",environment="demo"}} {values["demo_latency_ms{service=\"checkout\",instance=\"api-2\",environment=\"demo\"}"]:.4f}',
                '# HELP demo_requests_per_second Synthetic request throughput.',
                '# TYPE demo_requests_per_second gauge',
                f'demo_requests_per_second{{service="checkout",instance="api-1",environment="demo"}} {values["demo_requests_per_second{service=\"checkout\",instance=\"api-1\",environment=\"demo\"}"]:.4f}',
                f'demo_requests_per_second{{service="checkout",instance="api-2",environment="demo"}} {values["demo_requests_per_second{service=\"checkout\",instance=\"api-2\",environment=\"demo\"}"]:.4f}',
                '# HELP demo_error_rate_percent Synthetic error rate percentage.',
                '# TYPE demo_error_rate_percent gauge',
                f'demo_error_rate_percent{{service="checkout",instance="api-1",environment="demo"}} {values["demo_error_rate_percent{service=\"checkout\",instance=\"api-1\",environment=\"demo\"}"]:.4f}',
                f'demo_error_rate_percent{{service="checkout",instance="api-2",environment="demo"}} {values["demo_error_rate_percent{service=\"checkout\",instance=\"api-2\",environment=\"demo\"}"]:.4f}',
                '',
            ]
        ).encode('utf-8')

        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args) -> None:
        return


if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', PORT), MetricsHandler)
    server.serve_forever()
