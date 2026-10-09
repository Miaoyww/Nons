"""Validate release metadata and collect Nons Windows release assets."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tomllib
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def validate_version(root, tag):
    if not re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", tag):
        raise ValueError("Release tag must be v<major>.<minor>.<patch>, for example v1.0.0")
    version = tag[1:]
    native = root / "app/src-tauri"
    cargo = tomllib.loads((native / "Cargo.toml").read_text(encoding="utf-8"))
    lock = tomllib.loads((native / "Cargo.lock").read_text(encoding="utf-8"))
    locked = next(p["version"] for p in lock["package"] if p["name"] == cargo["package"]["name"])
    versions = {
        "app/package.json": read_json(root / "app/package.json")["version"],
        "tauri.conf.json": read_json(native / "tauri.conf.json")["version"],
        "Cargo.toml": cargo["package"]["version"],
        "Cargo.lock": locked,
    }
    for name, actual in versions.items():
        if actual != version:
            raise ValueError(f"{name} has version {actual}; tag requires {version}")
    return version


def release_notes(root, tag):
    version = validate_version(root, tag)
    changelog = (root / "CHANGELOG.md").read_text(encoding="utf-8-sig")
    sections = re.split(r"^## ", changelog, flags=re.MULTILINE)
    for section in sections[1:]:
        heading, _, body = section.partition("\n")
        if re.fullmatch(rf"\[{re.escape(version)}\](?: - \d{{4}}-\d{{2}}-\d{{2}})?\s*", heading):
            if body.strip():
                return body.strip() + "\n"
            break
    raise ValueError(f"No release notes found in CHANGELOG.md for [{version}]")


def collect_files(root, tag, output):
    version = validate_version(root, tag)
    native = root / "app/src-tauri"
    config = read_json(native / "tauri.conf.json")
    product = config["productName"]
    bundle = native / "target/release/bundle"
    sources = []
    for directory, suffix in [("msi", ".msi"), ("nsis", ".exe")]:
        matches = sorted((bundle / directory).glob(f"{product}_{version}_*{suffix}"))
        if len(matches) != 1:
            raise ValueError(f"Expected one {directory} installer for {version}, found {len(matches)}")
        sources.append((matches[0], matches[0].name))
    plugin = native / "bundled-plugins/netease-island.zip"
    with zipfile.ZipFile(plugin) as archive:
        manifest = json.loads(archive.read("manifest.json"))
    source_manifest = read_json(root / "plugins/netease-island/manifest.json")
    if manifest != source_manifest:
        raise ValueError("Bundled plugin manifest is stale; rebuild the plugin")
    if manifest["engines"]["app"] != f"^{version.split('.')[0]}.0.0":
        raise ValueError("Bundled plugin must declare compatibility with the release major version")
    sources.append((plugin, f"netease-island-{manifest['version']}.zip"))
    if output.exists() and any(output.iterdir()):
        raise ValueError(f"Release output must be empty: {output}")
    output.mkdir(parents=True, exist_ok=True)
    checksums = []
    for source, name in sources:
        target = output / name
        shutil.copy2(source, target)
        with target.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        checksums.append(f"{digest}  {name}\n")
        print(f"Collect: {name}")
    (output / "SHA256SUMS.txt").write_text("".join(checksums), encoding="utf-8", newline="\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["notes", "files"])
    parser.add_argument("tag")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.command == "notes":
        notes = release_notes(ROOT, args.tag)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(notes, encoding="utf-8")
        print(f"Release notes: {args.output}")
    else:
        collect_files(ROOT, args.tag, args.output)


if __name__ == "__main__":
    main()
