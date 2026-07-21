from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from convert_codex_pet import (
    ATLAS_HEIGHT,
    ATLAS_WIDTH,
    CELL_HEIGHT,
    CELL_WIDTH,
    ConversionError,
    ConversionOptions,
    LOOK_DIRECTIONS,
    NEUTRAL_CELL,
    STANDARD_ROWS,
    convert_codex_pet,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class ConvertCodexPetTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.output = self.root / "output"
        self.write_source()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_source(self, *, sprite_version: int = 2) -> None:
        height = ATLAS_HEIGHT if sprite_version == 2 else CELL_HEIGHT * 9
        image = Image.new("RGBA", (ATLAS_WIDTH, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        if sprite_version == 2:
            counts = {row: count for _, _, row, count, _, _ in STANDARD_ROWS}
            counts[9] = 8
            counts[10] = 8
        else:
            counts = {row: count for _, _, row, count, _, _ in STANDARD_ROWS}
        for row, count in counts.items():
            for column in range(count):
                left = column * CELL_WIDTH + 48
                top = row * CELL_HEIGHT + 36
                draw.rounded_rectangle(
                    (left, top, left + 96, top + 128),
                    radius=24,
                    fill=(
                        60 + row * 10,
                        100 + column * 8,
                        180,
                        255,
                    ),
                )
        if sprite_version == 2:
            row, column = NEUTRAL_CELL
            left = column * CELL_WIDTH + 48
            top = row * CELL_HEIGHT + 36
            draw.rounded_rectangle(
                (left, top, left + 96, top + 128),
                radius=24,
                fill=(60, 148, 180, 255),
            )
        image.save(self.source / "spritesheet.png", compress_level=1)
        (self.source / "pet.json").write_text(
            json.dumps(
                {
                    "id": "synthetic-v2",
                    "displayName": "Synthetic V2",
                    "description": "仅用于验证确定性裁帧和安全边界。",
                    "spriteVersionNumber": sprite_version,
                    "spritesheetPath": "spritesheet.png",
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    def options(self, **overrides) -> ConversionOptions:
        values = {
            "source_dir": self.source,
            "output_dir": self.output,
            "source_url": "https://example.com/synthetic-v2",
            "author": "WatchBuddy Tests",
            "license_name": "Synthetic Test Redistribution License",
            "license_url": "https://example.com/synthetic-v2/license",
            "attribution": "Synthetic fixture created by WatchBuddy tests.",
        }
        values.update(overrides)
        return ConversionOptions(**values)

    def test_converts_v2_atlas_and_generates_preview(self) -> None:
        result = convert_codex_pet(self.options())
        manifest = result["manifest"]

        self.assertEqual(len(manifest["assets"]), 57 + len(LOOK_DIRECTIONS))
        self.assertEqual(manifest["source"]["spriteVersionNumber"], 2)
        self.assertEqual(len(manifest["lookDirections"]), 16)
        self.assertTrue((self.output / "watch-pet.json").is_file())
        self.assertTrue((self.output / "conversion-report.json").is_file())
        with Image.open(self.output / "preview-466.png") as preview:
            self.assertEqual(preview.size, (466, 466))
        with Image.open(self.output / "contact-sheet.png") as contact_sheet:
            self.assertEqual(contact_sheet.size, (1088, 1470))
        self.assertRegex(
            result["report"]["output"]["contactSheetSha256"],
            r"^[a-f0-9]{64}$",
        )

        command = [
            "node",
            str(REPOSITORY_ROOT / "scripts/validate-watch-pet-bundle.mjs"),
            str(self.output),
        ]
        completed = subprocess.run(
            command,
            cwd=REPOSITORY_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_can_omit_look_directions_without_treating_v1_as_v2(self) -> None:
        result = convert_codex_pet(
            self.options(include_look_directions=False)
        )

        self.assertNotIn("lookDirections", result["manifest"])
        self.assertEqual(len(result["manifest"]["assets"]), 57)
        self.assertEqual(
            result["report"]["output"]["includesLookDirections"],
            False,
        )

    def test_quantized_png_preserves_transparency_and_small_frames(self) -> None:
        result = convert_codex_pet(
            self.options(output_format="png", png_colors=256)
        )
        first = result["manifest"]["assets"][0]
        frame_path = self.output / first["path"]

        self.assertEqual(result["report"]["output"]["pngColors"], 256)
        self.assertLess(first["bytes"], 7 * 1024)
        with Image.open(frame_path) as frame:
            alpha = frame.convert("RGBA").getchannel("A")
            self.assertEqual(alpha.getextrema(), (0, 255))

    def test_rejects_png_palette_option_for_webp(self) -> None:
        with self.assertRaisesRegex(ConversionError, "只适用于 PNG"):
            convert_codex_pet(self.options(png_colors=256))

    def test_rejects_legacy_v1_source(self) -> None:
        self.write_source(sprite_version=1)

        with self.assertRaisesRegex(ConversionError, "spriteVersionNumber"):
            convert_codex_pet(self.options())
        self.assertFalse(self.output.exists())

    def test_private_local_mode_converts_unversioned_v1_without_redistribution(self) -> None:
        self.write_source(sprite_version=1)
        manifest_path = self.source / "pet.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        del manifest["spriteVersionNumber"]
        manifest["id"] = "private-local-pet"
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False),
            encoding="utf-8",
        )

        result = convert_codex_pet(
            self.options(
                source_url="",
                license_url="",
                license_name="",
                output_format="png",
                png_colors=256,
                include_look_directions=False,
                private_local_use=True,
            )
        )
        converted = result["manifest"]

        self.assertEqual(len(converted["assets"]), 57)
        self.assertNotIn("lookDirections", converted)
        self.assertEqual(converted["source"]["spriteVersionNumber"], 1)
        self.assertEqual(converted["source"]["format"], "codex-pet-v1-local")
        self.assertEqual(converted["source"]["sourceUrl"], "local-only")
        self.assertFalse(
            converted["source"]["license"]["redistributionAllowed"]
        )
        self.assertTrue(
            all(asset["path"].endswith(".png") for asset in converted["assets"])
        )
        self.assertTrue(result["report"]["output"]["privateLocalUse"])

    def test_private_local_mode_requires_png(self) -> None:
        with self.assertRaisesRegex(ConversionError, "只接受 PNG"):
            convert_codex_pet(self.options(private_local_use=True))

    def test_rejects_nontransparent_unused_cell(self) -> None:
        with Image.open(self.source / "spritesheet.png") as loaded:
            image = loaded.convert("RGBA")
        draw = ImageDraw.Draw(image)
        left = 7 * CELL_WIDTH
        draw.rectangle((left, 0, left + 10, 10), fill=(255, 0, 0, 255))
        image.save(self.source / "spritesheet.png", compress_level=1)

        with self.assertRaisesRegex(ConversionError, "未使用格必须透明"):
            convert_codex_pet(self.options())
        self.assertFalse(self.output.exists())

    def test_rejects_missing_v2_neutral_cell(self) -> None:
        with Image.open(self.source / "spritesheet.png") as loaded:
            image = loaded.convert("RGBA")
        row, column = NEUTRAL_CELL
        draw = ImageDraw.Draw(image)
        left = column * CELL_WIDTH
        top = row * CELL_HEIGHT
        draw.rectangle(
            (left, top, left + CELL_WIDTH - 1, top + CELL_HEIGHT - 1),
            fill=(0, 0, 0, 0),
        )
        image.save(self.source / "spritesheet.png", compress_level=1)

        with self.assertRaisesRegex(ConversionError, "图集必需格为空"):
            convert_codex_pet(self.options())
        self.assertFalse(self.output.exists())

    def test_rejects_unknown_license_and_existing_output(self) -> None:
        with self.assertRaisesRegex(ConversionError, "未知或未授权"):
            convert_codex_pet(self.options(license_name="unknown"))

        self.output.mkdir()
        marker = self.output / "keep.txt"
        marker.write_text("keep", encoding="utf-8")
        with self.assertRaisesRegex(ConversionError, "拒绝覆盖"):
            convert_codex_pet(self.options())
        self.assertEqual(marker.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
