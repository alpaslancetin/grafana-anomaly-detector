from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from app.dynamic_rules import DynamicRuleRegistry, RegistrationConflict, RegistrationError


def registration(panel_id: int, sync_hash: str = 'stable-hash') -> dict[str, object]:
    return {
        'dashboardUid': 'dashboard-a',
        'dashboardTitle': 'Dashboard A',
        'panelId': panel_id,
        'panelTitle': f'Panel {panel_id}',
        'target': 'prometheus',
        'syncHash': sync_hash,
        'scopeHash': 'saved',
        'scopePolicy': 'saved',
        'resolvedOptions': {'algorithm': 'mad', 'sensitivity': 4, 'baselineWindow': 12},
        'targets': [{'refId': 'A', 'expr': f'metric_{panel_id}', 'datasourceType': 'prometheus'}],
    }


class DynamicRuleStateTests(unittest.TestCase):
    def test_repeated_registration_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            registry = DynamicRuleRegistry(Path(temp_dir) / 'dynamic_rules.json')
            first = registry.upsert_panel_registration(registration(1))
            first_mtime = registry.state_path.stat().st_mtime_ns
            for _ in range(50):
                result = registry.upsert_panel_registration(registration(1))
                self.assertEqual(result['status'], 'unchanged')
                self.assertEqual(result['revision'], first['revision'])
            self.assertEqual(registry.state_write_count, 1)
            self.assertEqual(registry.unchanged_count, 50)
            self.assertEqual(registry.state_path.stat().st_mtime_ns, first_mtime)

    def test_concurrent_panels_do_not_lose_state(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / 'dynamic_rules.json'
            registry = DynamicRuleRegistry(state_path)
            errors: list[Exception] = []

            def worker(panel_id: int) -> None:
                try:
                    registry.upsert_panel_registration(registration(panel_id, f'hash-{panel_id}'))
                except Exception as exc:  # noqa: BLE001
                    errors.append(exc)

            threads = [threading.Thread(target=worker, args=(panel_id,)) for panel_id in range(1, 51)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=5)

            self.assertEqual(errors, [])
            self.assertEqual(len(registry.list_records()), 50)
            self.assertEqual(len(json.loads(state_path.read_text(encoding='utf-8'))['rules']), 50)
            self.assertEqual(len(DynamicRuleRegistry(state_path).list_records()), 50)

    def test_independent_registry_instances_use_the_process_lock(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / 'dynamic_rules.json'
            registries = [DynamicRuleRegistry(state_path), DynamicRuleRegistry(state_path)]
            errors: list[Exception] = []

            def worker(panel_id: int) -> None:
                try:
                    registries[panel_id % 2].upsert_panel_registration(registration(panel_id, f'hash-{panel_id}'))
                except Exception as exc:  # noqa: BLE001
                    errors.append(exc)

            threads = [threading.Thread(target=worker, args=(panel_id,)) for panel_id in range(1, 31)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=5)

            self.assertEqual(errors, [])
            self.assertEqual(len(DynamicRuleRegistry(state_path).list_records()), 30)

    def test_invalid_state_is_not_silently_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / 'dynamic_rules.json'
            state_path.write_text('{broken', encoding='utf-8')
            registry = DynamicRuleRegistry(state_path)
            self.assertFalse(registry.health()['ready'])
            with self.assertRaises(RegistrationError):
                registry.upsert_panel_registration(registration(1))
            self.assertEqual(state_path.read_text(encoding='utf-8'), '{broken')

    def test_runtime_scopes_do_not_overwrite_each_other_and_revision_conflicts_are_detected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            registry = DynamicRuleRegistry(Path(temp_dir) / 'dynamic_rules.json')
            first_payload = registration(7, 'hash-a')
            first_payload.update({'scopePolicy': 'runtime', 'scopeHash': 'runtime-a'})
            first = registry.upsert_panel_registration(first_payload)

            second_payload = registration(7, 'hash-b')
            second_payload.update({'scopePolicy': 'runtime', 'scopeHash': 'runtime-b'})
            registry.upsert_panel_registration(second_payload)
            self.assertEqual(len(registry.list_records()), 2)
            self.assertEqual({record.scope_hash for record in registry.list_records()}, {'runtime-a', 'runtime-b'})

            stale_payload = registration(7, 'hash-c')
            stale_payload.update(
                {
                    'scopePolicy': 'runtime',
                    'scopeHash': 'runtime-a',
                    'expectedRevision': int(first['revision']) + 1,
                }
            )
            with self.assertRaises(RegistrationConflict):
                registry.upsert_panel_registration(stale_payload)

    def test_empty_targets_delete_only_the_selected_scope(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            registry = DynamicRuleRegistry(Path(temp_dir) / 'dynamic_rules.json')
            saved_payload = registration(7, 'saved-hash')
            runtime_payload = registration(7, 'runtime-hash')
            runtime_payload.update({'scopePolicy': 'runtime', 'scopeHash': 'runtime-a'})
            registry.upsert_panel_registration(saved_payload)
            registry.upsert_panel_registration(runtime_payload)

            delete_payload = registration(7, 'delete-hash')
            delete_payload.update({'scopePolicy': 'runtime', 'scopeHash': 'runtime-a', 'targets': []})
            result = registry.upsert_panel_registration(delete_payload)

            self.assertEqual(result['status'], 'deleted')
            self.assertEqual(len(result['removed']), 1)
            self.assertEqual({record.scope_hash for record in registry.list_records()}, {'saved'})

    def test_explicit_delete_and_runtime_ttl_preserve_saved_rules(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            registry = DynamicRuleRegistry(Path(temp_dir) / 'dynamic_rules.json')
            registry.upsert_panel_registration(registration(7, 'saved'))
            runtime_payload = registration(8, 'runtime')
            runtime_payload.update({'scopePolicy': 'runtime', 'scopeHash': 'runtime-old'})
            registry.upsert_panel_registration(runtime_payload)
            for record in registry.records.values():
                if record.scope_policy == 'runtime':
                    record.last_seen_at = time.time() - 120
            registry.save()

            removed = registry.prune_expired_runtime_scopes(60)
            self.assertEqual(len(removed), 1)
            self.assertEqual({record.scope_policy for record in registry.list_records()}, {'saved'})
            result = registry.delete_panel_registration('dashboard-a', 7, 'saved')
            self.assertEqual(result['status'], 'deleted')
            self.assertEqual(registry.list_records(), [])

    def test_registration_limits_reject_excess_targets_queries_and_total_rules(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            registry = DynamicRuleRegistry(Path(temp_dir) / 'dynamic_rules.json')
            oversized = registration(1)
            oversized['targets'] = [
                {'refId': str(index), 'expr': f'metric_{index}', 'datasourceType': 'prometheus'} for index in range(3)
            ]
            with self.assertRaises(RegistrationError):
                registry.upsert_panel_registration(oversized, max_rules_per_panel=2)

            long_query = registration(1)
            long_query['targets'] = [{'refId': 'A', 'expr': 'x' * 20, 'datasourceType': 'prometheus'}]
            with self.assertRaises(RegistrationError):
                registry.upsert_panel_registration(long_query, max_query_length=10)

            registry.upsert_panel_registration(registration(1), max_dynamic_rules=1)
            with self.assertRaises(RegistrationError):
                registry.upsert_panel_registration(registration(2, 'second'), max_dynamic_rules=1)


if __name__ == '__main__':
    unittest.main()
