"""Reconstruct named override files in a new directory; never install or deploy."""
from pathlib import Path
import hashlib
import io
import json
import subprocess
import sys
import tarfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main():
    package, archive, output = sys.argv[1:4]
    build_root = sys.argv[4] if len(sys.argv) == 5 else None
    if build_root is not None and any(c in build_root for c in ('\n', '\r')):
        raise ValueError('Build root must occupy one line')
    here = Path(__file__).resolve().parent
    row = next(p for p in json.loads((here / 'manifest.json').read_text())['packages'] if p['package'] == package)
    data = Path(archive).read_bytes()
    if sha(data) != row['baseSha256']:
        raise ValueError('Base archive SHA256 differs')
    target = Path(output).resolve()
    target.mkdir(parents=True, exist_ok=False)
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as bundle:
        members = {m.name.removeprefix('package/'): m for m in bundle.getmembers() if m.isfile()}
        for change in row['changes']:
            path = (target / change['path']).resolve()
            if not path.is_relative_to(target):
                raise ValueError('Manifest path escapes output directory')
            if change['before'] is None:
                continue
            content = bundle.extractfile(members[change['path']]).read()
            if sha(content) != change['before']:
                raise ValueError('Base file SHA256 differs: ' + change['path'])
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
    if row['patch']:
        subprocess.run(['git', 'init', '-q', str(target)], check=True)
        subprocess.run(['git', 'apply', str(here / row['patch'])], cwd=target, check=True)
    for change in row['changes']:
        path = target / change['path']
        content = path.read_bytes()
        if b'__DSH_BUILD_ROOT__' in content:
            if build_root is None:
                raise ValueError('This patch requires the original build root as the fourth argument')
            path.write_bytes(content.replace(b'__DSH_BUILD_ROOT__', build_root.encode()))
        if sha(path.read_bytes()) != change['after']:
            raise ValueError('Result SHA256 differs: ' + change['path'])
    print(json.dumps({'package': package, 'filesVerified': len(row['changes']), 'output': str(target)}))


if __name__ == '__main__':
    main()
