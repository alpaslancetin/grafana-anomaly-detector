import unittest

from detection_quality_check import production_quality_failures


class QualityGateTests(unittest.TestCase):
    def test_low_seasonal_recall_cannot_pass_on_onset_alone(self):
        failures = production_quality_failures({'hard': {'seasonal': {
            'event_recall': 0.2, 'precision': 0.9, 'f1': 0.9, 'shift_onset': 0}}})
        self.assertTrue(any('recall' in item for item in failures))

    def test_low_precision_and_f1_are_independent_blockers(self):
        failures = production_quality_failures({'clear': {'mad': {
            'event_recall': 1.0, 'precision': 0.25, 'f1': 0.4}}})
        self.assertEqual(len(failures), 2)

    def test_all_thresholds_must_be_satisfied(self):
        self.assertEqual(production_quality_failures({'hard': {'seasonal': {
            'event_recall': 0.8, 'precision': 0.8, 'f1': 0.8}}}), [])


if __name__ == '__main__':
    unittest.main()
