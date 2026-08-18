from __future__ import annotations

from ..models import SinkDefinition
from .base import AnomalySink, DisabledSink, SinkManager
from .clickhouse import ClickHouseSink
from .elasticsearch import ElasticsearchSink
from .influxdb import InfluxDBSink
from .loki import LokiSink
from .postgresql import PostgreSQLSink


SINK_CLASSES = {
    'loki': LokiSink,
    'influxdb': InfluxDBSink,
    'postgresql': PostgreSQLSink,
    'clickhouse': ClickHouseSink,
    'elasticsearch': ElasticsearchSink,
}


def build_sink_manager(definitions: dict[str, SinkDefinition]) -> SinkManager:
    sinks: list[AnomalySink] = []
    for name, definition in sorted(definitions.items()):
        if not definition.enabled and not definition.error:
            continue
        if definition.error:
            sinks.append(DisabledSink(name, definition.error))
            continue
        sink_class = SINK_CLASSES.get(name)
        if sink_class is None:
            sinks.append(DisabledSink(name, f'unsupported sink {name!r}'))
            continue
        try:
            sinks.append(sink_class(definition.settings))
        except Exception as exc:  # noqa: BLE001
            sinks.append(DisabledSink(name, str(exc)))
    return SinkManager(sinks)
