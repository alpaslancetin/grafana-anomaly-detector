"""Build versioned release ZIPs from an already tested production plugin build.

No runtime registry, credentials, caches, or local QA evidence is packaged.
Run after committing source and building the plugin. Output is deterministic
for the same source commit and dist bytes.
"""
import argparse
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def archive(path, files, metadata):
    manifest = dict(metadata, files={name: sha(data) for name, data in sorted(files.items())})
    prefix = next(iter(files)).split('/')[0]
    files = dict(files)
    files[prefix + '/BUILD_INFO.json'] = (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode()
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (0o100755 if name.endswith('.sh') else 0o100644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None
        for name, digest in manifest['files'].items():
            assert sha(z.read(name)) == digest, name
    print(f'{path.name}: {len(files)} files; sha256={sha(path.read_bytes())}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', default='1.5.0-r1')
    args = parser.parse_args()
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-r\d+)?', args.revision):
        parser.error('Invalid package revision')
    panel = ROOT / 'grafana-anomaly-detector-panel'
    exporter = ROOT / 'prometheus-live-demo/anomaly_exporter'
    version = json.loads((panel / 'package.json').read_text())['version']
    plugin = json.loads((panel / 'dist/plugin.json').read_text())
    assert plugin['info']['version'] == version == args.revision.split('-r')[0]
    assert f"__version__ = '{version}'" in (exporter / 'app/__init__.py').read_text()
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    metadata = {'packageRevision': args.revision, 'applicationVersion': version, 'sourceCommit': commit}
    release = ROOT / 'release'

    def normalized(path):
        data = path.read_bytes()
        if path.suffix in {'.py', '.sh', '.yml', '.md', '.txt', '.service', '.example', '.snippet'}:
            data = data.replace(b'\r\n', b'\n')
        return data

    plugin_files = {plugin['id'] + '/' + p.relative_to(panel / 'dist').as_posix(): p.read_bytes()
                    for p in sorted((panel / 'dist').rglob('*')) if p.is_file()}
    assert any(name.endswith('/module.js') for name in plugin_files)
    archive(release / f'grafana-anomaly-detector-plugin-{args.revision}.zip', plugin_files, metadata)

    prefix = 'grafana-anomaly-exporter-bundle/'
    files = {}
    for directory, suffixes in [('app', {'.py'}), ('examples', {'.yml', '.md'})]:
        for p in sorted((exporter / directory).rglob('*')):
            if p.is_file() and p.suffix in suffixes:
                files[prefix + 'exporter/' + p.relative_to(exporter).as_posix()] = normalized(p)
    for name in ['config.yml', 'main.py', 'requirements.txt', 'requirements-postgresql.txt', 'rules.yml']:
        files[prefix + 'exporter/' + name] = normalized(exporter / name)
    files[prefix + 'portable-exporter.sh'] = normalized(exporter / 'portable-exporter.sh')
    for p in sorted((exporter / 'packaging').iterdir()):
        if p.is_file():
            files[prefix + p.name] = normalized(p)
    files[prefix + 'exporter/state/dynamic_rules.json'] = b'{"rules": []}\n'
    for source, destination in [
        ('PACKAGE_CONTENTS_v1.5.0_TR.md', 'README_TR.md'),
        ('GRAFANA_ANOMALY_DETECTOR_E2E_KURULUM_UPGRADE_KILAVUZU_v1.5.0_TR.md',
         'GRAFANA_ANOMALY_DETECTOR_E2E_KURULUM_UPGRADE_KILAVUZU_TR.md')]:
        files[prefix + destination] = normalized(release / source)
    files[prefix + 'ANOMALYALARM_PROXY_TR.md'] = normalized(ROOT / 'docs/ANOMALYALARM_PROXY_TR.md')
    archive(release / f'grafana-anomaly-exporter-bundle-{args.revision}.zip', files, metadata)
    packages = [release / f'grafana-anomaly-detector-plugin-{args.revision}.zip',
                release / f'grafana-anomaly-exporter-bundle-{args.revision}.zip']
    (release / f'SHA256SUMS_v{args.revision}.txt').write_text(
        ''.join(f'{sha(p.read_bytes())}  {p.name}\n' for p in packages), encoding='utf-8')


if __name__ == '__main__':
    main()
