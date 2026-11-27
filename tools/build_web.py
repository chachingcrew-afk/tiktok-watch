"""Join web/src/*.js (in file name order) into web/app.js, the single script the website and the chat copy load.
Usage:
    python tools/build_web.py
"""
import pathlib

WEB = pathlib.Path(__file__).resolve().parent.parent / "web"


def main() -> None:
    parts = sorted((WEB / "src").glob("*.js"))
    out = "\n".join(p.read_text() for p in parts)
    (WEB / "app.js").write_text(out)
    print(WEB / "app.js", len(out), "bytes from", len(parts), "files")


if __name__ == "__main__":
    main()
