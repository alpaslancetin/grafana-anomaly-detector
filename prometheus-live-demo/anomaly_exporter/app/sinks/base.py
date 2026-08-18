from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import logging
import math
import queue
import threading
import time
from typing import Any
import urllib.error
import urllib.request

from ..models import RuleSnapshot, SeriesSnapshot

LOGGER = logging.getLogger('grafana_anomaly_exporter.sinks')


@dataclass
class SinkStatus:
    sink: str
    up: int = 0
    last_write_timestamp_seconds: float = 0.0
    write_duration_seconds: float = 0.0
    records_written_total: int = 0
    errors_total: int = 0
    last_error: str = 'none'


@dataclass
class EnqueueResult:
    queued: bool
    dropped: bool = False
    reason: str = 'none'
    queue_depth: int = 0
    queue_capacity: int = 0
    dropped_batches_total: int = 0
    last_drop_timestamp_seconds: float = 0.0


@dataclass
class SinkBatch:
    series_snapshots: list[SeriesSnapshot]
    rule_snapshots: list[RuleSnapshot]
    evaluation_time: float
    target_sinks: set[str] | None = None


class AnomalySink:
    name: str

    def __init__(self, name: str) -> None:
        self.name = name
        self.status = SinkStatus(sink=name)
        self._lock = threading.Lock()

    def write(self, batch: SinkBatch) -> int:
        raise NotImplementedError

    def write_with_metrics(self, batch: SinkBatch) -> None:
        start = time.time()
        try:
            written = self.write(batch)
        except Exception as exc:  # noqa: BLE001
            self.record_error(str(exc), time.time() - start)
            return

        with self._lock:
            was_down = self.status.up == 0 and self.status.last_error != 'none'
            self.status.up = 1
            self.status.last_write_timestamp_seconds = time.time()
            self.status.write_duration_seconds = time.time() - start
            self.status.records_written_total += max(0, written)
            self.status.last_error = 'none'
        if was_down:
            LOGGER.warning('sink recovered sink=%s records_written=%s', self.name, written)

    def record_error(self, message: str, duration: float = 0.0) -> None:
        sanitized = sanitize_error(message)
        with self._lock:
            self.status.up = 0
            self.status.write_duration_seconds = duration
            self.status.errors_total += 1
            self.status.last_error = sanitized
        LOGGER.warning('sink error sink=%s error=%s', self.name, sanitized)

    def snapshot_status(self) -> SinkStatus:
        with self._lock:
            return SinkStatus(**self.status.__dict__)


class DisabledSink(AnomalySink):
    def __init__(self, name: str, reason: str) -> None:
        super().__init__(name)
        self.record_error(reason)

    def write(self, batch: SinkBatch) -> int:
        return 0


class SinkManager:
    def __init__(self, sinks: list[AnomalySink], queue_size: int = 128) -> None:
        self.sinks = sinks
        self.queue: queue.Queue[SinkBatch | None] = queue.Queue(maxsize=max(1, queue_size))
        self._closed = threading.Event()
        self._stats_lock = threading.Lock()
        self.dropped_batches_total = 0
        self.last_drop_timestamp_seconds = 0.0
        self.worker: threading.Thread | None = None
        if self.sinks:
            self.worker = threading.Thread(target=self._loop, daemon=True)
            self.worker.start()

    def enqueue(
        self,
        series_snapshots: list[SeriesSnapshot],
        rule_snapshots: list[RuleSnapshot],
        evaluation_time: float,
        target_sinks: list[str] | set[str] | None = None,
    ) -> EnqueueResult:
        capacity = self.queue.maxsize
        depth = self.queue.qsize()
        if not self.sinks:
            return EnqueueResult(False, reason='no sinks configured', queue_depth=depth, queue_capacity=capacity)
        if self._closed.is_set():
            return EnqueueResult(False, dropped=True, reason='sink manager closed', queue_depth=depth, queue_capacity=capacity, dropped_batches_total=self.dropped_batches_total, last_drop_timestamp_seconds=self.last_drop_timestamp_seconds)
        normalized_targets = None if target_sinks is None else {item.lower() for item in target_sinks}
        matching_sinks = [sink for sink in self.sinks if normalized_targets is None or sink.name.lower() in normalized_targets]
        if not matching_sinks:
            reason = 'no enabled sink matches target'
            self._record_drop(reason)
            LOGGER.warning('sink enqueue dropped reason=%s targets=%s', reason, sorted(normalized_targets or []))
            return EnqueueResult(False, dropped=True, reason=reason, queue_depth=depth, queue_capacity=capacity, dropped_batches_total=self.dropped_batches_total, last_drop_timestamp_seconds=self.last_drop_timestamp_seconds)
        batch = SinkBatch(list(series_snapshots), list(rule_snapshots), evaluation_time, normalized_targets)
        try:
            self.queue.put_nowait(batch)
            return EnqueueResult(True, queue_depth=self.queue.qsize(), queue_capacity=capacity, dropped_batches_total=self.dropped_batches_total, last_drop_timestamp_seconds=self.last_drop_timestamp_seconds)
        except queue.Full:
            reason = 'sink queue full; dropped evaluation batch'
            self._record_drop(reason)
            LOGGER.warning('sink enqueue dropped reason=%s queue_depth=%s queue_capacity=%s', reason, self.queue.qsize(), capacity)
            for sink in matching_sinks:
                sink.record_error('sink queue full; dropped evaluation batch')
            return EnqueueResult(False, dropped=True, reason=reason, queue_depth=self.queue.qsize(), queue_capacity=capacity, dropped_batches_total=self.dropped_batches_total, last_drop_timestamp_seconds=self.last_drop_timestamp_seconds)

    def close(self) -> None:
        self._closed.set()
        try:
            self.queue.put_nowait(None)
        except queue.Full:
            pass

    def statuses(self) -> list[SinkStatus]:
        return [sink.snapshot_status() for sink in self.sinks]

    def queue_status(self) -> EnqueueResult:
        return EnqueueResult(
            queued=False,
            reason='status',
            queue_depth=self.queue.qsize(),
            queue_capacity=self.queue.maxsize,
            dropped_batches_total=self.dropped_batches_total,
            last_drop_timestamp_seconds=self.last_drop_timestamp_seconds,
        )

    def _record_drop(self, reason: str) -> None:
        with self._stats_lock:
            self.dropped_batches_total += 1
            self.last_drop_timestamp_seconds = time.time()

    def _loop(self) -> None:
        while not self._closed.is_set():
            batch = self.queue.get()
            if batch is None:
                return
            for sink in self.sinks:
                if batch.target_sinks is not None and sink.name.lower() not in batch.target_sinks:
                    continue
                sink.write_with_metrics(batch)


def snapshot_records(batch: SinkBatch) -> list[dict[str, Any]]:
    records = [series_snapshot_record(snapshot) for snapshot in batch.series_snapshots]
    records.extend(rule_snapshot_record(snapshot) for snapshot in batch.rule_snapshots)
    return records


def series_snapshot_record(snapshot: SeriesSnapshot) -> dict[str, Any]:
    return {
        'record_type': 'series',
        'timestamp': snapshot.timestamp,
        'rule': snapshot.rule_name,
        'source_metric': snapshot.source_metric,
        'labels': dict(snapshot.labels),
        'value': snapshot.value,
        'expected': snapshot.expected,
        'deviation': snapshot.deviation,
        'lower_bound': snapshot.lower,
        'upper_bound': snapshot.upper,
        'normalized_score': snapshot.normalized_score,
        'raw_score': snapshot.raw_score,
        'point_raw_score': snapshot.point_raw_score,
        'window_raw_score': snapshot.window_raw_score,
        'confidence_score': snapshot.confidence_score,
        'is_anomaly': bool(snapshot.is_anomaly),
        'severity_label': snapshot.severity_label,
        'severity_preset': snapshot.severity_preset,
        'algorithm': snapshot.algorithm,
        'threshold': snapshot.threshold,
        'confidence_label': snapshot.confidence_label,
        'data_quality_label': snapshot.data_quality_label,
        'score_driver': snapshot.score_driver,
    }


def rule_snapshot_record(snapshot: RuleSnapshot) -> dict[str, Any]:
    return {
        'record_type': 'rule',
        'timestamp': snapshot.timestamp,
        'rule': snapshot.name,
        'source_metric': '__rule__',
        'labels': {},
        'value': snapshot.max_score,
        'expected': None,
        'deviation': None,
        'lower_bound': None,
        'upper_bound': None,
        'normalized_score': snapshot.max_score,
        'raw_score': snapshot.max_raw_score,
        'point_raw_score': None,
        'window_raw_score': None,
        'confidence_score': None,
        'is_anomaly': snapshot.breach_count > 0,
        'severity_label': snapshot.max_severity_label,
        'severity_preset': snapshot.severity_preset,
        'algorithm': snapshot.algorithm,
        'threshold': None,
        'series_count': snapshot.series_count,
        'breach_count': snapshot.breach_count,
        'active_series': snapshot.active_series,
        'query': snapshot.query,
    }


def unix_ns(timestamp: float) -> str:
    return str(int(timestamp * 1_000_000_000))


def iso_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat().replace('+00:00', 'Z')


def json_bytes(payload: object) -> bytes:
    return json.dumps(payload, separators=(',', ':'), sort_keys=True).encode('utf-8')


def finite_number(value: object) -> float | int | None:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return value
    return None


def http_request(
    url: str,
    *,
    method: str = 'POST',
    body: bytes = b'',
    headers: dict[str, str] | None = None,
    timeout_seconds: int = 5,
    verify: bool = True,
) -> bytes:
    request = urllib.request.Request(url=url, data=body if method != 'GET' else None, headers=headers or {}, method=method)
    opener = urllib.request.urlopen
    if not verify and url.lower().startswith('https://'):
        import ssl

        context = ssl._create_unverified_context()
        with opener(request, timeout=timeout_seconds, context=context) as response:  # type: ignore[arg-type]
            return response.read()
    with opener(request, timeout=timeout_seconds) as response:
        return response.read()


def sanitize_error(message: str) -> str:
    sanitized = str(message).replace('\n', ' ').replace('\r', ' ').strip()
    for token in ('password=', 'token=', 'Authorization:', 'Basic ', 'Bearer '):
        index = sanitized.lower().find(token.lower())
        if index >= 0:
            sanitized = sanitized[: index + len(token)] + '<redacted>'
    return sanitized[:240] if sanitized else 'unknown error'
