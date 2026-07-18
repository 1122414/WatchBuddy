#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import tempfile
import warnings
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from PIL import Image, ImageDraw, ImageOps
from PIL.Image import DecompressionBombError, DecompressionBombWarning


TOOL_VERSION = "1.1.0"
ATLAS_WIDTH = 1536
ATLAS_HEIGHT = 2288
CELL_WIDTH = 192
CELL_HEIGHT = 208
MAX_SOURCE_MANIFEST_BYTES = 64 * 1024
MAX_SOURCE_SPRITESHEET_BYTES = 32 * 1024 * 1024
MAX_FRAME_BYTES = 64 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024
MAX_IMAGE_PIXELS = 10_000_000
HASH_PATTERN = re.compile(r"^[a-f0-9]{64}$")
PET_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
SOURCE_FILE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.(png|webp)$")
UNKNOWN_LICENSES = {"none", "unknown", "unlicensed", "unspecified"}

STANDARD_ROWS = (
    ("idle", "idle", 0, 6, (280, 110, 110, 140, 140, 320), True),
    (
        "runningRight",
        "running-right",
        1,
        8,
        (120, 120, 120, 120, 120, 120, 120, 220),
        True,
    ),
    (
        "runningLeft",
        "running-left",
        2,
        8,
        (120, 120, 120, 120, 120, 120, 120, 220),
        True,
    ),
    ("waving", "waving", 3, 4, (140, 140, 140, 280), False),
    ("jumping", "jumping", 4, 5, (140, 140, 140, 140, 280), False),
    (
        "failed",
        "failed",
        5,
        8,
        (140, 140, 140, 140, 140, 140, 140, 240),
        False,
    ),
    ("waiting", "waiting", 6, 6, (150, 150, 150, 150, 150, 260), True),
    ("running", "running", 7, 6, (120, 120, 120, 120, 120, 220), True),
    ("review", "review", 8, 6, (150, 150, 150, 150, 150, 280), True),
)

LOOK_DIRECTIONS = (
    "000",
    "022.5",
    "045",
    "067.5",
    "090",
    "112.5",
    "135",
    "157.5",
    "180",
    "202.5",
    "225",
    "247.5",
    "270",
    "292.5",
    "315",
    "337.5",
)
NEUTRAL_CELL = (0, 6)


class ConversionError(ValueError):
    pass


@dataclass(frozen=True)
class ConversionOptions:
    source_dir: Path
    output_dir: Path
    source_url: str
    author: str
    license_name: str
    license_url: str
    attribution: str
    pet_id: str | None = None
    display_name: str | None = None
    description: str | None = None
    frame_width: int = 128
    display_size: int = 176
    output_format: str = "webp"
    quality: int = 82
    png_colors: int = 0
    include_look_directions: bool = True


def convert_codex_pet(options: ConversionOptions) -> dict[str, Any]:
    validate_options(options)
    source_dir = options.source_dir.expanduser().resolve()
    output_dir = options.output_dir.expanduser().resolve()
    if not source_dir.is_dir():
        raise ConversionError(f"源目录不存在: {source_dir}")
    if output_dir.exists():
        raise ConversionError(f"输出目录已存在，拒绝覆盖: {output_dir}")

    source_manifest_path = source_dir / "pet.json"
    reject_non_regular_file(source_manifest_path, "pet.json")
    source_manifest_bytes = read_limited(
        source_manifest_path,
        MAX_SOURCE_MANIFEST_BYTES,
        "pet.json",
    )
    source_manifest = parse_source_manifest(source_manifest_bytes)
    spritesheet_path = resolve_spritesheet(source_dir, source_manifest)
    spritesheet_bytes = read_limited(
        spritesheet_path,
        MAX_SOURCE_SPRITESHEET_BYTES,
        "spritesheet",
    )

    source_id = source_manifest["id"]
    pet_id = options.pet_id or source_id
    display_name = options.display_name or source_manifest["displayName"]
    description = options.description or source_manifest["description"]
    validate_text(display_name, 1, 32, "displayName")
    validate_text(description, 1, 160, "description")
    if not PET_ID_PATTERN.fullmatch(pet_id):
        raise ConversionError("pet id 必须是 1 到 48 位小写字母、数字或连字符")

    source_manifest_sha256 = sha256(source_manifest_bytes)
    source_spritesheet_sha256 = sha256(spritesheet_bytes)
    source_package_sha256 = sha256(
        b"watchbuddy-codex-pet-v2\0"
        + source_manifest_bytes
        + b"\0"
        + spritesheet_bytes
    )

    image = load_and_validate_atlas(spritesheet_bytes)
    frame_height = round(options.frame_width * CELL_HEIGHT / CELL_WIDTH)
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    temporary_dir = Path(
        tempfile.mkdtemp(
            prefix=f".{output_dir.name}.tmp-",
            dir=output_dir.parent,
        )
    )
    try:
        manifest = build_bundle(
            image=image,
            options=options,
            temporary_dir=temporary_dir,
            pet_id=pet_id,
            display_name=display_name,
            description=description,
            frame_height=frame_height,
            source_package_sha256=source_package_sha256,
        )
        manifest_path = temporary_dir / "watch-pet.json"
        write_json(manifest_path, manifest)
        preview_path = temporary_dir / "preview-466.png"
        create_preview(
            temporary_dir / manifest["assets"][0]["path"],
            preview_path,
            options.display_size,
        )
        contact_sheet_path = temporary_dir / "contact-sheet.png"
        create_contact_sheet(
            temporary_dir,
            manifest["assets"],
            contact_sheet_path,
            options.frame_width,
            frame_height,
        )
        report = {
            "toolVersion": TOOL_VERSION,
            "source": {
                "manifestSha256": source_manifest_sha256,
                "spritesheetSha256": source_spritesheet_sha256,
                "packageSha256": source_package_sha256,
            },
            "output": {
                "manifestSha256": sha256(manifest_path.read_bytes()),
                "previewSha256": sha256(preview_path.read_bytes()),
                "contactSheetSha256": sha256(contact_sheet_path.read_bytes()),
                "assetCount": len(manifest["assets"]),
                "totalBytes": manifest["budget"]["totalBytes"],
                "frameWidth": options.frame_width,
                "frameHeight": frame_height,
                "format": options.output_format,
                "pngColors": options.png_colors or None,
                "includesLookDirections": options.include_look_directions,
            },
        }
        write_json(temporary_dir / "conversion-report.json", report)
        temporary_dir.rename(output_dir)
        return {
            "manifest": manifest,
            "output_dir": output_dir,
            "report": report,
        }
    except Exception:
        shutil.rmtree(temporary_dir, ignore_errors=True)
        raise
    finally:
        image.close()


def validate_options(options: ConversionOptions) -> None:
    validate_https_url(options.source_url, "source_url")
    validate_https_url(options.license_url, "license_url")
    validate_text(options.author, 1, 80, "author")
    validate_text(options.license_name, 1, 64, "license_name")
    validate_text(options.attribution, 1, 240, "attribution")
    if options.license_name.strip().lower() in UNKNOWN_LICENSES:
        raise ConversionError("license_name 不能是未知或未授权")
    if not 32 <= options.frame_width <= CELL_WIDTH:
        raise ConversionError("frame_width 必须为 32 到 192")
    frame_height = round(options.frame_width * CELL_HEIGHT / CELL_WIDTH)
    if not 32 <= frame_height <= CELL_HEIGHT:
        raise ConversionError("缩放后的 frame height 超出范围")
    if not 64 <= options.display_size <= 200:
        raise ConversionError("display_size 必须为 64 到 200")
    if options.output_format not in {"png", "webp"}:
        raise ConversionError("output_format 必须为 png 或 webp")
    if not 1 <= options.quality <= 100:
        raise ConversionError("quality 必须为 1 到 100")
    if options.png_colors != 0 and not 16 <= options.png_colors <= 256:
        raise ConversionError("png_colors 必须为 0 或 16 到 256")
    if options.output_format != "png" and options.png_colors != 0:
        raise ConversionError("png_colors 只适用于 PNG 输出")


def parse_source_manifest(raw: bytes) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ConversionError("pet.json 不是有效 UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise ConversionError("pet.json 必须是对象")
    for key in (
        "id",
        "displayName",
        "description",
        "spriteVersionNumber",
        "spritesheetPath",
    ):
        if key not in value:
            raise ConversionError(f"pet.json 缺少字段 {key}")
    if value["spriteVersionNumber"] != 2:
        raise ConversionError("只接受 spriteVersionNumber: 2 的 Codex Pet")
    if not isinstance(value["id"], str) or not PET_ID_PATTERN.fullmatch(value["id"]):
        raise ConversionError("pet.json id 无效")
    validate_text(value["displayName"], 1, 80, "pet.json displayName")
    validate_text(value["description"], 1, 240, "pet.json description")
    if (
        not isinstance(value["spritesheetPath"], str)
        or not SOURCE_FILE_PATTERN.fullmatch(value["spritesheetPath"])
    ):
        raise ConversionError("spritesheetPath 必须是同目录 PNG/WebP 文件名")
    return value


def resolve_spritesheet(source_dir: Path, manifest: dict[str, Any]) -> Path:
    path = source_dir / manifest["spritesheetPath"]
    reject_non_regular_file(path, "spritesheet")
    resolved = path.resolve()
    if resolved.parent != source_dir:
        raise ConversionError("spritesheetPath 不能离开源目录")
    return resolved


def load_and_validate_atlas(raw: bytes) -> Image.Image:
    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    with warnings.catch_warnings():
        warnings.simplefilter("error", DecompressionBombWarning)
        try:
            source = Image.open(BytesIO(raw))
            source.load()
        except (DecompressionBombError, DecompressionBombWarning) as error:
            raise ConversionError("图集解码像素超出安全上限") from error
        except Exception as error:
            raise ConversionError("无法解码 PNG/WebP 图集") from error

    if source.format not in {"PNG", "WEBP"}:
        source.close()
        raise ConversionError("图集格式必须是 PNG 或 WebP")
    if getattr(source, "n_frames", 1) != 1:
        source.close()
        raise ConversionError("图集必须是单帧图片")
    if source.size != (ATLAS_WIDTH, ATLAS_HEIGHT):
        size = source.size
        source.close()
        raise ConversionError(
            f"v2 图集必须为 {ATLAS_WIDTH}x{ATLAS_HEIGHT}，实际为 {size[0]}x{size[1]}"
        )
    if "A" not in source.getbands():
        source.close()
        raise ConversionError("图集必须包含透明通道")

    image = source.convert("RGBA")
    source.close()
    validate_atlas_cells(image)
    return image


def validate_atlas_cells(image: Image.Image) -> None:
    used_by_row = {
        row: set(range(count))
        for _, _, row, count, _, _ in STANDARD_ROWS
    }
    used_by_row[NEUTRAL_CELL[0]].add(NEUTRAL_CELL[1])
    used_by_row[9] = set(range(8))
    used_by_row[10] = set(range(8))

    for row in range(11):
        used_columns = used_by_row[row]
        for column in range(8):
            alpha = crop_cell(image, row, column).getchannel("A")
            non_empty = alpha.getbbox() is not None
            if column in used_columns and not non_empty:
                raise ConversionError(f"图集必需格为空: row={row}, column={column}")
            if row < 9 and column not in used_columns and non_empty:
                raise ConversionError(
                    f"图集未使用格必须透明: row={row}, column={column}"
                )


def build_bundle(
    *,
    image: Image.Image,
    options: ConversionOptions,
    temporary_dir: Path,
    pet_id: str,
    display_name: str,
    description: str,
    frame_height: int,
    source_package_sha256: str,
) -> dict[str, Any]:
    assets: list[dict[str, Any]] = []
    animations: dict[str, Any] = {}

    for animation, directory, row, count, durations, loop in STANDARD_ROWS:
        frame_ids = []
        for column in range(count):
            frame_id = f"{directory}-{column}"
            relative_path = (
                f"frames/{directory}/{column:03d}.{options.output_format}"
            )
            asset = write_frame(
                crop_cell(image, row, column),
                temporary_dir / relative_path,
                frame_id,
                relative_path,
                options,
                frame_height,
            )
            assets.append(asset)
            frame_ids.append(frame_id)
        animations[animation] = {
            "frames": frame_ids,
            "durationsMs": list(durations),
            "loop": loop,
        }

    look_directions = None
    if options.include_look_directions:
        look_directions = {}
        for index, direction in enumerate(LOOK_DIRECTIONS):
            row = 9 if index < 8 else 10
            column = index if index < 8 else index - 8
            frame_id = f"look-{index:02d}"
            relative_path = (
                f"frames/look/{index:03d}.{options.output_format}"
            )
            asset = write_frame(
                crop_cell(image, row, column),
                temporary_dir / relative_path,
                frame_id,
                relative_path,
                options,
                frame_height,
            )
            assets.append(asset)
            look_directions[direction] = frame_id

    total_bytes = sum(asset["bytes"] for asset in assets)
    max_frame_bytes = max(asset["bytes"] for asset in assets)
    if total_bytes > MAX_TOTAL_BYTES:
        raise ConversionError(
            f"转换后资源总大小 {total_bytes} 超过 {MAX_TOTAL_BYTES}"
        )

    manifest: dict[str, Any] = {
        "schemaVersion": 1,
        "id": pet_id,
        "displayName": display_name,
        "description": description,
        "renderer": "frame-sequence-v1",
        "source": {
            "format": "codex-pet-v2",
            "spriteVersionNumber": 2,
            "sourceUrl": options.source_url,
            "author": options.author,
            "license": {
                "name": options.license_name,
                "url": options.license_url,
                "redistributionAllowed": True,
            },
            "attribution": options.attribution,
            "sha256": source_package_sha256,
        },
        "frame": {
            "width": options.frame_width,
            "height": frame_height,
            "displayWidth": options.display_size,
            "displayHeight": options.display_size,
        },
        "assets": assets,
        "animations": animations,
        "stateMap": {
            "sleeping": "idle",
            "idle": "idle",
            "daydreaming": "waiting",
            "watching": "review",
            "curious": "jumping",
            "concerned": "waiting",
            "chatting": "waving",
            "giving_space": "idle",
        },
        "interactionMap": {
            "tap": "jumping",
            "message": "waving",
            "loading": "running",
            "failure": "failed",
        },
        "fallbackFrame": assets[0]["id"],
        "budget": {
            "frameCount": len(assets),
            "totalBytes": total_bytes,
            "maxFrameBytes": max_frame_bytes,
        },
    }
    if look_directions is not None:
        manifest["lookDirections"] = look_directions
    return manifest


def write_frame(
    frame: Image.Image,
    output_path: Path,
    frame_id: str,
    relative_path: str,
    options: ConversionOptions,
    frame_height: int,
) -> dict[str, Any]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    resized = frame.resize(
        (options.frame_width, frame_height),
        Image.Resampling.LANCZOS,
    )
    if options.output_format == "webp":
        resized.save(
            output_path,
            format="WEBP",
            quality=options.quality,
            method=6,
            exact=True,
        )
    else:
        output = resized
        if options.png_colors:
            output = resized.quantize(
                colors=options.png_colors,
                method=Image.Quantize.FASTOCTREE,
                dither=Image.Dither.NONE,
            )
        output.save(
            output_path,
            format="PNG",
            optimize=True,
            compress_level=9,
        )
        if output is not resized:
            output.close()
    raw = output_path.read_bytes()
    if not raw or len(raw) > MAX_FRAME_BYTES:
        raise ConversionError(
            f"转换后单帧 {relative_path} 大小 {len(raw)} 超过 {MAX_FRAME_BYTES}"
        )
    return {
        "id": frame_id,
        "path": relative_path,
        "sha256": sha256(raw),
        "bytes": len(raw),
    }


def create_preview(frame_path: Path, output_path: Path, display_size: int) -> None:
    canvas = Image.new("RGBA", (466, 466), (38, 43, 51, 255))
    draw = ImageDraw.Draw(canvas)
    draw.ellipse((1, 1, 464, 464), fill=(12, 16, 24, 255))
    draw.ellipse((20, 20, 34, 34), fill=(123, 242, 191, 255))
    draw.rounded_rectangle(
        (118, 24, 348, 42),
        radius=9,
        fill=(38, 51, 73, 255),
    )

    with Image.open(frame_path) as source:
        pet = ImageOps.contain(
            source.convert("RGBA"),
            (display_size, display_size),
            Image.Resampling.LANCZOS,
        )
    pet_x = (466 - pet.width) // 2
    pet_y = 62 + (display_size - pet.height) // 2
    canvas.alpha_composite(pet, (pet_x, pet_y))
    draw.rounded_rectangle(
        (61, 265, 405, 337),
        radius=24,
        fill=(24, 33, 49, 255),
    )
    draw.rounded_rectangle(
        (92, 360, 202, 414),
        radius=27,
        fill=(123, 242, 191, 255),
    )
    draw.rounded_rectangle(
        (264, 360, 374, 414),
        radius=27,
        fill=(38, 51, 73, 255),
    )
    canvas.save(output_path, format="PNG", optimize=True)


def create_contact_sheet(
    root: Path,
    assets: list[dict[str, Any]],
    output_path: Path,
    frame_width: int,
    frame_height: int,
) -> None:
    columns = 8
    gap = 4
    rows = math.ceil(len(assets) / columns)
    cell_width = frame_width + gap * 2
    cell_height = frame_height + gap * 2
    canvas = Image.new(
        "RGBA",
        (columns * cell_width, rows * cell_height),
        (24, 28, 36, 255),
    )
    draw = ImageDraw.Draw(canvas)

    for index, asset in enumerate(assets):
        column = index % columns
        row = index // columns
        left = column * cell_width + gap
        top = row * cell_height + gap
        draw.rectangle(
            (left, top, left + frame_width - 1, top + frame_height - 1),
            fill=(48, 54, 66, 255),
        )
        with Image.open(root / asset["path"]) as source:
            frame = source.convert("RGBA")
        canvas.alpha_composite(frame, (left, top))
        frame.close()

    canvas.save(output_path, format="PNG", optimize=True)
    canvas.close()


def crop_cell(image: Image.Image, row: int, column: int) -> Image.Image:
    left = column * CELL_WIDTH
    top = row * CELL_HEIGHT
    return image.crop((left, top, left + CELL_WIDTH, top + CELL_HEIGHT))


def reject_non_regular_file(path: Path, label: str) -> None:
    if path.is_symlink() or not path.is_file():
        raise ConversionError(f"{label} 必须是普通文件且不能是符号链接")


def read_limited(path: Path, limit: int, label: str) -> bytes:
    size = path.stat().st_size
    if size < 1 or size > limit:
        raise ConversionError(f"{label} 大小必须为 1 到 {limit} 字节")
    raw = path.read_bytes()
    if len(raw) != size:
        raise ConversionError(f"{label} 读取长度发生变化")
    return raw


def validate_text(value: Any, minimum: int, maximum: int, label: str) -> None:
    if not isinstance(value, str):
        raise ConversionError(f"{label} 必须是字符串")
    length = len(value.strip())
    if length < minimum or length > maximum:
        raise ConversionError(f"{label} 长度必须为 {minimum} 到 {maximum}")


def validate_https_url(value: str, label: str) -> None:
    if not isinstance(value, str) or len(value) > 512:
        raise ConversionError(f"{label} 必须是不含凭据的 HTTPS URL")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
    ):
        raise ConversionError(f"{label} 必须是不含凭据的 HTTPS URL")


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def sha256(raw: bytes) -> str:
    digest = hashlib.sha256(raw).hexdigest()
    if not HASH_PATTERN.fullmatch(digest):
        raise AssertionError("SHA-256 生成失败")
    return digest


def parse_args() -> ConversionOptions:
    parser = argparse.ArgumentParser(
        description="将通过校验的 Codex Pet v2 转换为 WatchBuddy 手表资源",
    )
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--author", required=True)
    parser.add_argument("--license-name", required=True)
    parser.add_argument("--license-url", required=True)
    parser.add_argument("--attribution", required=True)
    parser.add_argument("--pet-id")
    parser.add_argument("--display-name")
    parser.add_argument("--description")
    parser.add_argument("--frame-width", type=int, default=128)
    parser.add_argument("--display-size", type=int, default=176)
    parser.add_argument("--format", choices=("png", "webp"), default="webp")
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument(
        "--png-colors",
        type=int,
        default=0,
        help="PNG 调色板颜色数（0 保留 RGBA，16-256 启用量化）",
    )
    parser.add_argument(
        "--omit-look-directions",
        action="store_true",
        help="不把 v2 的 16 个注视方向写入手表资源",
    )
    args = parser.parse_args()
    return ConversionOptions(
        source_dir=args.source_dir,
        output_dir=args.output_dir,
        source_url=args.source_url,
        author=args.author,
        license_name=args.license_name,
        license_url=args.license_url,
        attribution=args.attribution,
        pet_id=args.pet_id,
        display_name=args.display_name,
        description=args.description,
        frame_width=args.frame_width,
        display_size=args.display_size,
        output_format=args.format,
        quality=args.quality,
        png_colors=args.png_colors,
        include_look_directions=not args.omit_look_directions,
    )


def main() -> int:
    try:
        result = convert_codex_pet(parse_args())
    except ConversionError as error:
        print(f"✗ 转换失败：{error}")
        return 1
    print(
        "✓ 转换完成："
        f"{result['output_dir']}，"
        f"{result['report']['output']['assetCount']} 帧，"
        f"{result['report']['output']['totalBytes']} 字节"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
