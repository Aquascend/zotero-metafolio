"""Build an installable Zotero XPI using only the Python standard library."""

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def main():
    root = Path(__file__).resolve().parent
    source = root / 'addon'
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf-8'))
    output = root / f"metafolio-{manifest['version']}.xpi"
    temporary = output.with_suffix('.xpi.tmp')
    with ZipFile(temporary, 'w') as package:
        for path in sorted(source.rglob('*')):
            if path.is_file():
                entry = ZipInfo(path.relative_to(source).as_posix())
                entry.compress_type = ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                package.writestr(entry, path.read_bytes())
    temporary.replace(output)
    print(output)


if __name__ == '__main__':
    main()
