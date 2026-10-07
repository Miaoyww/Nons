"""Package a built plugin with manifest.json at the ZIP root."""
import pathlib
import sys
import zipfile

source = pathlib.Path(sys.argv[1]).resolve(strict=True)
destination = pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(source.rglob("*")):
        if path.is_symlink():
            raise ValueError("Plugin resources must not be symlinks")
        if path.is_file():
            archive.write(path, path.relative_to(source).as_posix())
print(f"ZIP: {destination}")
