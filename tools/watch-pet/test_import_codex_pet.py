from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw

from convert_codex_pet import (
    ATLAS_HEIGHT,
    ATLAS_WIDTH,
    CELL_HEIGHT,
    CELL_WIDTH,
    NEUTRAL_CELL,
    STANDARD_ROWS,
)
from import_codex_pet import (
    FetchResult,
    ImportError,
    ImportOptions,
    MAX_PACKAGE_BYTES,
    import_codex_pet,
)


class ImportCodexPetTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        image = Image.new(
            "RGBA",
            (ATLAS_WIDTH, ATLAS_HEIGHT),
            (0, 0, 0, 0),
        )
        draw = ImageDraw.Draw(image)
        counts = {row: count for _, _, row, count, _, _ in STANDARD_ROWS}
        counts[9] = 8
        counts[10] = 8
        for row, count in counts.items():
            for column in range(count):
                left = column * CELL_WIDTH + 48
                top = row * CELL_HEIGHT + 36
                draw.rounded_rectangle(
                    (left, top, left + 96, top + 128),
                    radius=24,
                    fill=(50 + row * 10, 90 + column * 8, 180, 255),
                )
        row, column = NEUTRAL_CELL
        left = column * CELL_WIDTH + 48
        top = row * CELL_HEIGHT + 36
        draw.rounded_rectangle(
            (left, top, left + 96, top + 128),
            radius=24,
            fill=(80, 150, 190, 255),
        )
        spritesheet = BytesIO()
        image.save(spritesheet, format="PNG", compress_level=1)
        image.close()
        cls.spritesheet = spritesheet.getvalue()
        cls.manifest = {
            "id": "licensed-v2",
            "displayName": "Licensed V2",
            "description": "用于验证受控远程导入边界。",
            "spriteVersionNumber": 2,
            "spritesheetPath": "spritesheet.png",
        }
        cls.package = cls.make_package()

    @classmethod
    def make_package(
        cls,
        *,
        manifest: dict[str, object] | None = None,
        spritesheet: bytes | None = None,
        extra: tuple[str, bytes] | None = None,
    ) -> bytes:
        output = BytesIO()
        selected_manifest = manifest or cls.manifest
        with zipfile.ZipFile(
            output,
            "w",
            compression=zipfile.ZIP_DEFLATED,
        ) as archive:
            archive.writestr(
                "pet.json",
                json.dumps(
                    selected_manifest,
                    ensure_ascii=False,
                ).encode("utf-8"),
            )
            archive.writestr(
                selected_manifest["spritesheetPath"],
                spritesheet if spritesheet is not None else cls.spritesheet,
            )
            if extra:
                archive.writestr(extra[0], extra[1])
        return output.getvalue()

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.output = Path(self.temporary.name) / "source"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def options(self, **overrides) -> ImportOptions:
        values = {
            "source_url": (
                "https://codex-pets.net/api/pets/licensed-v2/download"
                "?v=123"
            ),
            "output_dir": self.output,
            "author": "Licensed Pet Author",
            "license_id": "CC-BY-4.0",
            "license_evidence_url": (
                "https://github.com/example/licensed-v2/blob/main/LICENSE"
            ),
            "attribution": "Licensed V2 by Licensed Pet Author.",
        }
        values.update(overrides)
        return ImportOptions(**values)

    def fetch_result(self, **overrides) -> FetchResult:
        values = {
            "body": self.package,
            "content_type": "application/zip",
            "final_url": (
                "https://codex-pets.net/api/pets/licensed-v2/download"
                "?v=123"
            ),
            "redirect_count": 0,
        }
        values.update(overrides)
        return FetchResult(**values)

    def test_imports_valid_licensed_v2_package_atomically(self) -> None:
        result = import_codex_pet(
            self.options(),
            fetcher=lambda _: self.fetch_result(),
        )

        self.assertEqual(result["manifest"]["id"], "licensed-v2")
        self.assertTrue((self.output / "pet.json").is_file())
        self.assertTrue((self.output / "spritesheet.png").is_file())
        provenance = json.loads(
            (self.output / "source-provenance.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(
            provenance["source"]["license"]["id"],
            "CC-BY-4.0",
        )
        self.assertTrue(
            provenance["source"]["license"]["redistributionAllowed"]
        )
        self.assertRegex(
            provenance["files"]["package"]["sha256"],
            r"^[a-f0-9]{64}$",
        )

    def test_rejects_unknown_license_and_site_page_as_evidence(self) -> None:
        with self.assertRaisesRegex(ImportError, "白名单"):
            import_codex_pet(
                self.options(license_id="unknown"),
                fetcher=lambda _: self.fetch_result(),
            )
        with self.assertRaisesRegex(ImportError, "不是单个宠物"):
            import_codex_pet(
                self.options(
                    license_evidence_url=(
                        "https://codex-pets.net/share/licensed-v2"
                    )
                ),
                fetcher=lambda _: self.fetch_result(),
            )

    def test_rejects_noncanonical_source_urls(self) -> None:
        invalid = (
            "http://codex-pets.net/api/pets/licensed-v2/download",
            "https://example.com/api/pets/licensed-v2/download",
            "https://codex-pets.net/share/licensed-v2",
            (
                "https://codex-pets.net/api/pets/licensed-v2/download"
                "?next=https://example.com"
            ),
        )
        for source_url in invalid:
            with self.subTest(source_url=source_url):
                with self.assertRaises(ImportError):
                    import_codex_pet(
                        self.options(source_url=source_url),
                        fetcher=lambda _: self.fetch_result(),
                    )

    def test_rejects_html_oversize_and_excessive_redirects(self) -> None:
        cases = (
            {
                "content_type": "text/html",
                "body": b"<html>not a pet</html>",
            },
            {
                "body": b"z" * (MAX_PACKAGE_BYTES + 1),
            },
            {
                "redirect_count": 3,
            },
        )
        for overrides in cases:
            with self.subTest(overrides=overrides):
                with self.assertRaises(ImportError):
                    import_codex_pet(
                        self.options(),
                        fetcher=lambda _, value=overrides: (
                            self.fetch_result(**value)
                        ),
                    )

    def test_rejects_path_traversal_and_unexpected_files(self) -> None:
        output = BytesIO()
        with zipfile.ZipFile(
            output,
            "w",
            compression=zipfile.ZIP_DEFLATED,
        ) as archive:
            archive.writestr(
                "pet.json",
                json.dumps(self.manifest).encode("utf-8"),
            )
            archive.writestr("../payload.js", b"alert(1)")
        malicious = output.getvalue()

        with self.assertRaisesRegex(ImportError, "路径穿越"):
            import_codex_pet(
                self.options(),
                fetcher=lambda _: self.fetch_result(body=malicious),
            )
        self.assertFalse(self.output.exists())

        unexpected = self.make_package(extra=("payload.js", b"alert(1)"))
        with self.assertRaisesRegex(ImportError, "必须且只能"):
            import_codex_pet(
                self.options(),
                fetcher=lambda _: self.fetch_result(body=unexpected),
            )

    def test_rejects_unknown_or_duplicate_manifest_fields(self) -> None:
        extended = dict(self.manifest)
        extended["scriptUrl"] = "https://example.com/payload.js"
        extended_package = self.make_package(manifest=extended)

        duplicate_manifest = (
            b'{"id":"licensed-v2","id":"other",'
            b'"displayName":"Duplicate","description":"duplicate",'
            b'"spriteVersionNumber":2,'
            b'"spritesheetPath":"spritesheet.png"}'
        )
        output = BytesIO()
        with zipfile.ZipFile(
            output,
            "w",
            compression=zipfile.ZIP_DEFLATED,
        ) as archive:
            archive.writestr("pet.json", duplicate_manifest)
            archive.writestr("spritesheet.png", self.spritesheet)

        with self.assertRaisesRegex(ImportError, "受支持的 v2 字段"):
            import_codex_pet(
                self.options(),
                fetcher=lambda _: self.fetch_result(
                    body=extended_package
                ),
            )
        with self.assertRaisesRegex(ImportError, "重复字段"):
            import_codex_pet(
                self.options(),
                fetcher=lambda _: self.fetch_result(body=output.getvalue()),
            )

    def test_rejects_legacy_or_fake_v2_package(self) -> None:
        legacy = dict(self.manifest)
        legacy["spriteVersionNumber"] = 1
        legacy_package = self.make_package(manifest=legacy)
        fake_image_package = self.make_package(spritesheet=b"<svg></svg>")

        with self.assertRaisesRegex(ImportError, "spriteVersionNumber"):
            import_codex_pet(
                self.options(),
                fetcher=lambda _: self.fetch_result(body=legacy_package),
            )
        with self.assertRaisesRegex(ImportError, "无法解码"):
            import_codex_pet(
                self.options(),
                fetcher=lambda _: self.fetch_result(
                    body=fake_image_package
                ),
            )

    def test_rejects_pet_id_mismatch_and_existing_output(self) -> None:
        with self.assertRaisesRegex(ImportError, "宠物 ID"):
            import_codex_pet(
                self.options(
                    source_url=(
                        "https://codex-pets.net/api/pets/other/download"
                    )
                ),
                fetcher=lambda _: self.fetch_result(
                    final_url=(
                        "https://codex-pets.net/api/pets/other/download"
                    )
                ),
            )

        self.output.mkdir()
        marker = self.output / "keep.txt"
        marker.write_text("keep", encoding="utf-8")
        with self.assertRaisesRegex(ImportError, "拒绝覆盖"):
            import_codex_pet(
                self.options(),
                fetcher=lambda _: self.fetch_result(),
            )
        self.assertEqual(marker.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
