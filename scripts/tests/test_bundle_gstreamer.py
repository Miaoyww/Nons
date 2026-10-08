import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("bundle", Path(__file__).resolve().parents[1] / "bundle-gstreamer.py")
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)

class DependencyTests(unittest.TestCase):
    def test_transitive_dependencies_and_cycles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {name: root / name for name in ["core.dll", "plugin.dll", "codec.dll"]}
            for path in files.values(): path.touch()
            graph = {"plugin.dll": ["core.dll"], "core.dll": ["codec.dll"], "codec.dll": ["core.dll", "KERNEL32.dll", "api-ms-win-core.dll"]}
            found = bundle.dependency_closure([files["plugin.dll"]], files, lambda path: graph[path.name], lambda name: name == "KERNEL32.dll")
            self.assertEqual({path.name for path in found}, set(files))

    def test_missing_transitive_dependency_fails_build(self):
        with tempfile.TemporaryDirectory() as directory:
            plugin = Path(directory) / "plugin.dll"; plugin.touch()
            with self.assertRaisesRegex(RuntimeError, "avcodec-61.dll"):
                bundle.dependency_closure([plugin], {}, lambda path: ["avcodec-61.dll"], lambda name: False)

    def test_missing_seed_fails_build(self):
        with self.assertRaisesRegex(RuntimeError, "Missing runtime file"):
            bundle.dependency_closure([Path("missing-runtime.dll")], {}, lambda path: [], lambda name: False)

if __name__ == "__main__": unittest.main()
