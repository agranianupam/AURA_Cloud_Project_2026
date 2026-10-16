"""Download the CU-BEMS CSVs (CC BY 4.0, doi:10.6084/m9.figshare.11726517) into dataset/raw/.

Usage: python src/ml_model/download_data.py [--out dataset/raw]
Files already present with the expected size are skipped.
"""
import argparse
import json
import os
import urllib.request

ARTICLE = "https://api.figshare.com/v2/articles/11726517"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="dataset/raw")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    with urllib.request.urlopen(ARTICLE) as r:
        files = [f for f in json.load(r)["files"] if f["name"].endswith(".csv")]
    for f in files:
        path = os.path.join(args.out, f["name"])
        if os.path.exists(path) and os.path.getsize(path) == f["size"]:
            print(f"ok       {f['name']}")
            continue
        print(f"download {f['name']} ({f['size'] / 1e6:.1f} MB)")
        urllib.request.urlretrieve(f["download_url"], path)
        if os.path.getsize(path) != f["size"]:
            raise SystemExit(f"size mismatch for {f['name']}; delete it and retry")


if __name__ == "__main__":
    main()
