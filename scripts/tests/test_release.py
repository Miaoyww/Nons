import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("release", Path(__file__).resolve().parents[1] / "release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.native = self.root / "app/src-tauri"
        self.native.mkdir(parents=True)
        self.write_json(self.root / "app/package.json", {"version": "1.0.0"})
        self.write_json(self.native / "tauri.conf.json", {"version": "1.0.0", "productName": "Nons"})
        (self.native / "Cargo.toml").write_text('[package]\nname = "nons"\nversion = "1.0.0"\n')
        (self.native / "Cargo.lock").write_text('[[package]]\nname = "nons"\nversion = "1.0.0"\n')
        (self.root / "CHANGELOG.md").write_text(
            '# Changelog\n\n## [Unreleased]\n\nFuture changes\n\n## [1.0.0]\n\n### Added\n\n- First release\n\n## [0.1.0]\n\nOld release\n'
        )
        self.output = self.root / "release-files"

    def write_json(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding="utf-8")

    def assets(self):
        for directory, name in [("msi", "Nons_1.0.0_x64_zh-CN.msi"), ("nsis", "Nons_1.0.0_x64-setup.exe")]:
            folder = self.native / "target/release/bundle" / directory
            folder.mkdir(parents=True)
            (folder / name).write_bytes(b"installer fixture")
            (folder / name.replace("1.0.0", "0.1.0")).write_bytes(b"stale installer")
        manifest = {"version": "1.3.0", "engines": {"app": "^1.0.0"}}
        self.write_json(self.root / "plugins/netease-island/manifest.json", manifest)
        folder = self.native / "bundled-plugins"
        folder.mkdir()
        with zipfile.ZipFile(folder / "netease-island.zip", "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))

    def test_notes_select_only_tagged_version(self):
        self.assertEqual(release.release_notes(self.root, "v1.0.0"), "### Added\n\n- First release\n")

    def test_version_mismatch_and_invalid_tags_fail(self):
        for tag in ["1.0.0", "v01.0.0", "v1.0.0-rc.1", "v1.0.1"]:
            with self.assertRaises(ValueError):
                release.validate_version(self.root, tag)
        self.write_json(self.root / "app/package.json", {"version": "0.1.0"})
        with self.assertRaisesRegex(ValueError, "app/package.json"):
            release.validate_version(self.root, "v1.0.0")

    def test_missing_or_empty_notes_fail(self):
        for content in ["## [Unreleased]\nFuture changes\n", "## [1.0.0]\n\n## [0.1.0]\nOld changes\n"]:
            (self.root / "CHANGELOG.md").write_text(content)
            with self.assertRaisesRegex(ValueError, "No release notes"):
                release.release_notes(self.root, "v1.0.0")

    def test_dated_heading_is_supported(self):
        (self.root / "CHANGELOG.md").write_text("## [1.0.0] - 2026-10-09\n\nRelease notes\n")
        self.assertEqual(release.release_notes(self.root, "v1.0.0"), "Release notes\n")

    def test_assets_exclude_old_versions_and_have_valid_checksums(self):
        self.assets()
        release.collect_files(self.root, "v1.0.0", self.output)
        self.assertEqual(len(list(self.output.iterdir())), 4)
        sums = (self.output / "SHA256SUMS.txt").read_bytes()
        self.assertNotIn(b"\r", sums)
        for line in sums.decode().splitlines():
            digest, name = line.split("  ")
            self.assertEqual(digest, hashlib.sha256((self.output / name).read_bytes()).hexdigest())
            self.assertNotIn("0.1.0", name)
        self.assertTrue((self.output / "netease-island-1.3.0.zip").is_file())

    def test_partial_build_and_stale_plugin_fail(self):
        self.assets()
        msi = self.native / "target/release/bundle/msi/Nons_1.0.0_x64_zh-CN.msi"
        msi.unlink()
        with self.assertRaisesRegex(ValueError, "msi installer"):
            release.collect_files(self.root, "v1.0.0", self.output)
        msi.write_bytes(b"installer fixture")
        self.write_json(self.root / "plugins/netease-island/manifest.json", {"version": "1.4.0"})
        with self.assertRaisesRegex(ValueError, "stale"):
            release.collect_files(self.root, "v1.0.0", self.output)
        self.assertFalse(self.output.exists())

    def test_nonempty_output_is_not_overwritten(self):
        self.assets()
        self.output.mkdir()
        existing = self.output / "existing.txt"
        existing.write_text("keep")
        with self.assertRaisesRegex(ValueError, "must be empty"):
            release.collect_files(self.root, "v1.0.0", self.output)
        self.assertEqual(existing.read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
