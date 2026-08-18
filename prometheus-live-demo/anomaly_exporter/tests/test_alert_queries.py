from __future__ import annotations

import unittest

from app.alert_queries import build_score_feed_registration


class AlertQueryTests(unittest.TestCase):
    def test_prometheus_queries_work_for_open_and_closed_panel_feeds(self) -> None:
        registration = build_score_feed_registration('checkout_latency', 'prometheus', None)

        self.assertNotIn('feed_source=', registration['query'])
        self.assertNotIn('feed_source=', registration['perSeriesQuery'])
        self.assertIn('rule="checkout_latency"', registration['query'])


if __name__ == '__main__':
    unittest.main()
