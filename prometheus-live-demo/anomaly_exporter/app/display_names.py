from __future__ import annotations

import re

LEGEND_LABEL_PATTERN = re.compile(r'{{\s*([^{}]+?)\s*}}')


def resolve_series_display_name(
    legend_template: str,
    labels: dict[str, str],
    generated_name: str,
    raw_identifier: str,
) -> str:
    """Match Grafana legend templates without changing valid explicit aliases."""
    template = str(legend_template or '')
    if template.strip():
        rendered = LEGEND_LABEL_PATTERN.sub(lambda match: str(labels.get(match.group(1).strip(), '')), template)
        if rendered.strip():
            return rendered

    for candidate in (labels.get('display_name', ''), generated_name, raw_identifier):
        value = str(candidate or '')
        if value.strip():
            return value
    return 'Series'
