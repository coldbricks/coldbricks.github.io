"""Inject accurate hover swatches into the manual's generated theme atlas."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
catalog = (root.parent / "FinallyPlayer/app/src/main/java/com/coldbricks/finallyplayer/ui/ClubThemeCatalog.kt").read_text(encoding="utf-8")
manual_path = root / "finally/manual/index.html"
manual = manual_path.read_text(encoding="utf-8")

specs = {}
for match in re.finditer(r'spec\(\s*"[^"]+",\s*"([^"]+)".*?preview\s*=\s*longArrayOf\((.*?)\)', catalog, re.S):
    label, colors = match.groups()
    hexes = re.findall(r'0x([0-9A-Fa-f]{6})', colors)[:4]
    if hexes:
        specs[label] = "linear-gradient(90deg," + ",".join("#" + h for h in hexes) + ")"

start = manual.index('<section id="themes">')
end = manual.index('</section>', start) + len('</section>')
atlas = manual[start:end]
for label, palette in sorted(specs.items(), key=lambda item: len(item[0]), reverse=True):
    old = f'<td>{label}</td>'
    new = f'<td><button class="theme-name" type="button" aria-label="{label}: show palette" style="--theme-swatch: {palette}">{label}</button></td>'
    atlas = atlas.replace(old, new)
manual_path.write_text(manual[:start] + atlas + manual[end:], encoding="utf-8")
print(f"swatches injected: {sum(1 for label in specs if f'>{label}</button>' in atlas)} / {len(specs)}")
