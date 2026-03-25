from app.server import DEFAULT_DYNAMIC_STATE_PATH, run_server

import os


if __name__ == '__main__':
    run_server(
        os.environ.get('ANOMALY_CONFIG_PATH', '/app/rules.yml'),
        os.environ.get('ANOMALY_DYNAMIC_RULES_PATH', DEFAULT_DYNAMIC_STATE_PATH),
    )
