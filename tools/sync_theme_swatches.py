"""Inject accurate hover swatches into the manual's generated theme atlas."""
from pathlib import Path
import re
from html import escape

root = Path(__file__).resolve().parents[1]
catalog = (root.parent / "FinallyPlayer/app/src/main/java/com/coldbricks/finallyplayer/ui/ClubThemeCatalog.kt").read_text(encoding="utf-8")
manual_path = root / "finally/manual/index.html"
manual = manual_path.read_text(encoding="utf-8")

specs = {}
pattern = re.compile(
    r'spec\(\s*"([^"]+)"\s*,\s*"([^"]+)".*?'
    r'Section\.[A-Za-z_]+\s*,\s*0x([0-9A-Fa-f]{6})\s*,\s*'
    r'0x([0-9A-Fa-f]{6})\s*,\s*0x([0-9A-Fa-f]{6}).*?'
    r'preview\s*=\s*longArrayOf\((.*?)\)',
    re.S,
)
for match in pattern.finditer(catalog):
    theme_id, label, bg, card, accent, colors = match.groups()
    hexes = re.findall(r'0x([0-9A-Fa-f]{6})', colors)[:4]
    if len(hexes) >= 3:
        text_match = re.search(r'(?<![A-Za-z])text\s*=\s*0x([0-9A-Fa-f]{6})', match.group(0))
        specs[label] = {
            "id": theme_id,
            "bg": "#" + bg,
            "card": "#" + card,
            "accent": "#" + accent,
            "text": "#" + (text_match.group(1) if text_match else "F7F5FA"),
            "gradient": "linear-gradient(90deg," + ",".join("#" + h for h in hexes) + ")",
        }

start = manual.index('<section id="themes">')
end = manual.index('</section>', start) + len('</section>')
atlas = manual[start:end]
for label, palette in sorted(specs.items(), key=lambda item: len(item[0]), reverse=True):
    old = f'<td>{label}</td>'
    safe_label = escape(label, quote=False)
    safe_attr = escape(label, quote=True)
    new = (
        f'<td><button class="theme-name" type="button" aria-label="{safe_attr}: preview theme" '
        f'aria-pressed="false" data-theme-id="{palette["id"]}" data-theme-bg="{palette["bg"]}" data-theme-card="{palette["card"]}" '
        f'data-theme-accent="{palette["accent"]}" data-theme-text="{palette["text"]}" '
        f'style="--theme-swatch: {palette["gradient"]}">{safe_label}</button></td>'
    )
    replaced = atlas.replace(old, new)
    if replaced != atlas:
        atlas = replaced
    else:
        button_pattern = re.compile(
            r'<td><button class="theme-name"[^>]*>' + re.escape(label) + r'</button></td>'
        )
        atlas = button_pattern.sub(new, atlas)
manual_path.write_text(manual[:start] + atlas + manual[end:], encoding="utf-8")
print(f"swatches injected: {sum(1 for label in specs if f'>{label}</button>' in atlas)} / {len(specs)}")
