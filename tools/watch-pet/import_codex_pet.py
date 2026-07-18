#!/usr/bin/env python3

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import shutil
import socket
import stat
import tempfile
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Callable
from urllib.error import HTTPError
from urllib.parse import parse_qsl, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from convert_codex_pet import (
    MAX_SOURCE_MANIFEST_BYTES,
    MAX_SOURCE_SPRITESHEET_BYTES,
    ConversionError,
    load_and_validate_atlas,
    parse_source_manifest,
    sha256,
    validate_https_url,
    validate_text,
    write_json,
)


TOOL_VERSION = "1.0.0"
SOURCE_HOST = "codex-pets.net"
MAX_REDIRECTS = 2
MAX_PACKAGE_BYTES = 12 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 2
MAX_COMPRESSION_RATIO = 250
READ_CHUNK_BYTES = 64 * 1024
PET_DOWNLOAD_PATH = re.compile(
    r"^/api/pets/(?P<pet_id>[a-z0-9][a-z0-9-]{0,47})/download$"
)
ALLOWED_CONTENT_TYPES = {
    "application/octet-stream",
    "application/x-zip-compressed",
    "application/zip",
    "binary/octet-stream",
}
LICENSES = {
    "Apache-2.0": "https://www.apache.org/licenses/LICENSE-2.0",
    "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "MIT": "https://opensource.org/license/mit",
}
SOURCE_MANIFEST_FIELDS = {
    "description",
    "displayName",
    "id",
    "spritesheetPath",
    "spriteVersionNumber",
}


class ImportError(ConversionError):
    pass


@dataclass(frozen=True)
class ImportOptions:
    source_url: str
    output_dir: Path
    author: str
    license_id: str
    license_evidence_url: str
    attribution: str


@dataclass(frozen=True)
class FetchResult:
    body: bytes
    content_type: str
    final_url: str
    redirect_count: int


Fetcher = Callable[[str], FetchResult]


class NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def import_codex_pet(
    options: ImportOptions,
    *,
    fetcher: Fetcher | None = None,
) -> dict[str, object]:
    try:
        return _import_codex_pet(options, fetcher=fetcher)
    except ImportError:
        raise
    except ConversionError as error:
        raise ImportError(str(error)) from error


def _import_codex_pet(
    options: ImportOptions,
    *,
    fetcher: Fetcher | None = None,
) -> dict[str, object]:
    source_pet_id = validate_source_url(options.source_url)
    validate_license(options)
    output_dir = options.output_dir.expanduser().resolve()
    if output_dir.exists():
        raise ImportError(f"输出目录已存在，拒绝覆盖: {output_dir}")

    result = (fetcher or fetch_package)(options.source_url)
    validate_fetch_result(result)
    if validate_source_url(result.final_url) != source_pet_id:
        raise ImportError("重定向不能切换到其他宠物 ID")
    manifest_bytes, spritesheet_name, spritesheet_bytes = inspect_package(
        result.body
    )
    manifest = parse_source_manifest(manifest_bytes)
    if manifest["id"] != source_pet_id:
        raise ImportError("下载 URL 的宠物 ID 与 pet.json id 不一致")
    if manifest["spritesheetPath"] != spritesheet_name:
        raise ImportError("pet.json spritesheetPath 与压缩包图片文件名不一致")

    image = load_and_validate_atlas(spritesheet_bytes)
    image.close()

    report = {
        "schemaVersion": 1,
        "importerVersion": TOOL_VERSION,
        "source": {
            "service": "codex-pets.net",
            "sourceUrl": options.source_url,
            "finalUrl": result.final_url,
            "redirectCount": result.redirect_count,
            "petId": manifest["id"],
            "author": options.author,
            "license": {
                "id": options.license_id,
                "url": LICENSES[options.license_id],
                "evidenceUrl": options.license_evidence_url,
                "redistributionAllowed": True,
            },
            "attribution": options.attribution,
        },
        "files": {
            "package": {
                "bytes": len(result.body),
                "sha256": sha256(result.body),
            },
            "pet.json": {
                "bytes": len(manifest_bytes),
                "sha256": sha256(manifest_bytes),
            },
            spritesheet_name: {
                "bytes": len(spritesheet_bytes),
                "sha256": sha256(spritesheet_bytes),
            },
        },
    }

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    temporary_dir = Path(
        tempfile.mkdtemp(
            prefix=f".{output_dir.name}.tmp-",
            dir=output_dir.parent,
        )
    )
    try:
        (temporary_dir / "pet.json").write_bytes(manifest_bytes)
        (temporary_dir / spritesheet_name).write_bytes(spritesheet_bytes)
        write_json(temporary_dir / "source-provenance.json", report)
        temporary_dir.rename(output_dir)
    except Exception:
        shutil.rmtree(temporary_dir, ignore_errors=True)
        raise

    return {
        "manifest": manifest,
        "output_dir": output_dir,
        "report": report,
    }


def validate_source_url(value: str) -> str:
    validate_https_url(value, "source_url")
    parsed = urlsplit(value)
    if parsed.hostname != SOURCE_HOST or parsed.port is not None:
        raise ImportError(f"source_url 仅允许 {SOURCE_HOST}")
    match = PET_DOWNLOAD_PATH.fullmatch(parsed.path)
    if not match:
        raise ImportError("source_url 必须是 codex-pets.net 的宠物下载 API")
    if parsed.fragment:
        raise ImportError("source_url 不能包含 fragment")
    query = parse_qsl(parsed.query, keep_blank_values=True)
    if query and (
        len(query) != 1
        or query[0][0] != "v"
        or not query[0][1].isdigit()
    ):
        raise ImportError("source_url 只允许数字 v 版本参数")
    return match.group("pet_id")


def validate_license(options: ImportOptions) -> None:
    validate_text(options.author, 1, 80, "author")
    validate_text(options.attribution, 1, 240, "attribution")
    if options.license_id not in LICENSES:
        allowed = ", ".join(sorted(LICENSES))
        raise ImportError(f"license_id 不在可再分发白名单中: {allowed}")
    validate_https_url(options.license_evidence_url, "license_evidence_url")
    parsed = urlsplit(options.license_evidence_url)
    if parsed.port is not None or parsed.fragment:
        raise ImportError("license_evidence_url 不能包含端口或 fragment")
    if parsed.hostname == SOURCE_HOST:
        raise ImportError("codex-pets.net 当前页面不是单个宠物的许可证证据")
    reject_non_public_literal_host(parsed.hostname or "")


def validate_fetch_result(result: FetchResult) -> None:
    validate_source_url(result.final_url)
    if result.redirect_count < 0 or result.redirect_count > MAX_REDIRECTS:
        raise ImportError("重定向次数超过安全上限")
    content_type = result.content_type.split(";", 1)[0].strip().lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise ImportError(f"下载响应 Content-Type 不允许: {content_type}")
    if not result.body or len(result.body) > MAX_PACKAGE_BYTES:
        raise ImportError(f"下载包大小必须为 1 到 {MAX_PACKAGE_BYTES} 字节")


def fetch_package(source_url: str) -> FetchResult:
    current_url = source_url
    redirect_count = 0
    opener = build_opener(NoRedirectHandler())

    while True:
        validate_source_url(current_url)
        ensure_public_dns(SOURCE_HOST)
        request = Request(
            current_url,
            headers={
                "Accept": "application/zip, application/octet-stream;q=0.9",
                "User-Agent": f"WatchBuddy-Pet-Importer/{TOOL_VERSION}",
            },
            method="GET",
        )
        try:
            response = opener.open(request, timeout=20)
        except HTTPError as error:
            if error.code not in {301, 302, 303, 307, 308}:
                raise ImportError(f"下载失败，HTTP {error.code}") from error
            location = error.headers.get("Location")
            if not location:
                raise ImportError("重定向响应缺少 Location") from error
            redirect_count += 1
            if redirect_count > MAX_REDIRECTS:
                raise ImportError("重定向次数超过安全上限") from error
            current_url = urljoin(current_url, location)
            validate_source_url(current_url)
            continue
        except OSError as error:
            raise ImportError(f"下载失败: {error}") from error

        with response:
            if response.status != 200:
                raise ImportError(f"下载失败，HTTP {response.status}")
            content_length = response.headers.get("Content-Length")
            if content_length is not None:
                try:
                    announced_size = int(content_length)
                except ValueError as error:
                    raise ImportError("Content-Length 无效") from error
                if announced_size < 1 or announced_size > MAX_PACKAGE_BYTES:
                    raise ImportError("Content-Length 超过安全上限")
            body = read_stream_limited(response, MAX_PACKAGE_BYTES)
            if content_length is not None and len(body) != announced_size:
                raise ImportError("响应实际长度与 Content-Length 不一致")
            return FetchResult(
                body=body,
                content_type=response.headers.get("Content-Type", ""),
                final_url=current_url,
                redirect_count=redirect_count,
            )


def ensure_public_dns(hostname: str) -> None:
    try:
        records = socket.getaddrinfo(
            hostname,
            443,
            type=socket.SOCK_STREAM,
        )
    except OSError as error:
        raise ImportError(f"无法解析来源主机: {error}") from error
    addresses = {record[4][0].split("%", 1)[0] for record in records}
    if not addresses:
        raise ImportError("来源主机没有可用地址")
    for address in addresses:
        try:
            parsed = ipaddress.ip_address(address)
        except ValueError as error:
            raise ImportError("来源主机返回无效 IP") from error
        if not parsed.is_global:
            raise ImportError("来源主机解析到非公网地址")


def reject_non_public_literal_host(hostname: str) -> None:
    try:
        parsed = ipaddress.ip_address(hostname)
    except ValueError:
        if hostname.lower() in {"localhost", "localhost.localdomain"}:
            raise ImportError("许可证证据不能指向本地主机")
        return
    if not parsed.is_global:
        raise ImportError("许可证证据不能指向非公网地址")


def read_stream_limited(stream: BinaryIO, limit: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = stream.read(min(READ_CHUNK_BYTES, limit - total + 1))
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise ImportError("下载包超过安全上限")
        chunks.append(chunk)
    return b"".join(chunks)


def inspect_package(raw: bytes) -> tuple[bytes, str, bytes]:
    if not zipfile.is_zipfile(BytesIO(raw)):
        raise ImportError("下载内容不是有效 ZIP")
    try:
        archive = zipfile.ZipFile(BytesIO(raw))
    except zipfile.BadZipFile as error:
        raise ImportError("下载内容不是有效 ZIP") from error

    with archive:
        infos = archive.infolist()
        if len(infos) != MAX_ARCHIVE_ENTRIES:
            raise ImportError("宠物包必须且只能包含 pet.json 和一张图集")
        names: list[str] = []
        seen_casefold: set[str] = set()
        for info in infos:
            validate_archive_entry(info)
            folded = info.filename.casefold()
            if folded in seen_casefold:
                raise ImportError("宠物包包含重复或大小写冲突文件")
            seen_casefold.add(folded)
            names.append(info.filename)

        if "pet.json" not in names:
            raise ImportError("宠物包缺少 pet.json")
        manifest_info = archive.getinfo("pet.json")
        validate_entry_size(
            manifest_info,
            MAX_SOURCE_MANIFEST_BYTES,
            "pet.json",
        )
        manifest_bytes = read_zip_entry(
            archive,
            manifest_info,
            MAX_SOURCE_MANIFEST_BYTES,
        )
        validate_remote_manifest_shape(manifest_bytes)
        manifest = parse_source_manifest(manifest_bytes)
        spritesheet_name = manifest["spritesheetPath"]
        if set(names) != {"pet.json", spritesheet_name}:
            raise ImportError("宠物包包含未声明文件或缺少图集")
        spritesheet_info = archive.getinfo(spritesheet_name)
        validate_entry_size(
            spritesheet_info,
            MAX_SOURCE_SPRITESHEET_BYTES,
            "spritesheet",
        )
        spritesheet_bytes = read_zip_entry(
            archive,
            spritesheet_info,
            MAX_SOURCE_SPRITESHEET_BYTES,
        )
        return manifest_bytes, spritesheet_name, spritesheet_bytes


def validate_remote_manifest_shape(raw: bytes) -> None:
    def reject_duplicate_keys(
        pairs: list[tuple[str, object]],
    ) -> dict[str, object]:
        value: dict[str, object] = {}
        for key, item in pairs:
            if key in value:
                raise ImportError(f"pet.json 包含重复字段: {key}")
            value[key] = item
        return value

    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=reject_duplicate_keys,
        )
    except ImportError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ImportError("pet.json 不是有效 UTF-8 JSON") from error
    if not isinstance(value, dict) or set(value) != SOURCE_MANIFEST_FIELDS:
        raise ImportError("远程 pet.json 只能包含受支持的 v2 字段")


def validate_archive_entry(info: zipfile.ZipInfo) -> None:
    path = PurePosixPath(info.filename)
    if (
        info.is_dir()
        or path.is_absolute()
        or len(path.parts) != 1
        or path.name in {"", ".", ".."}
        or "\\" in info.filename
        or "\x00" in info.filename
    ):
        raise ImportError("宠物包包含目录、路径穿越或非法文件名")
    mode = info.external_attr >> 16
    if stat.S_ISLNK(mode):
        raise ImportError("宠物包不能包含符号链接")
    if info.flag_bits & 0x1:
        raise ImportError("宠物包不能包含加密文件")
    if info.compress_size > MAX_PACKAGE_BYTES:
        raise ImportError("压缩条目超过安全上限")
    if (
        info.file_size > 0
        and info.file_size / max(info.compress_size, 1) > MAX_COMPRESSION_RATIO
    ):
        raise ImportError("压缩比超过安全上限")


def validate_entry_size(
    info: zipfile.ZipInfo,
    limit: int,
    label: str,
) -> None:
    if info.file_size < 1 or info.file_size > limit:
        raise ImportError(f"{label} 解压大小超过安全上限")


def read_zip_entry(
    archive: zipfile.ZipFile,
    info: zipfile.ZipInfo,
    limit: int,
) -> bytes:
    with archive.open(info, "r") as stream:
        raw = read_stream_limited(stream, limit)
    if len(raw) != info.file_size:
        raise ImportError("压缩包条目实际长度与目录不一致")
    return raw


def parse_args() -> ImportOptions:
    parser = argparse.ArgumentParser(
        description=(
            "从 codex-pets.net 受控下载并校验具有明确再分发授权的 "
            "Codex Pet v2"
        ),
    )
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--author", required=True)
    parser.add_argument(
        "--license-id",
        choices=tuple(sorted(LICENSES)),
        required=True,
    )
    parser.add_argument("--license-evidence-url", required=True)
    parser.add_argument("--attribution", required=True)
    args = parser.parse_args()
    return ImportOptions(
        source_url=args.source_url,
        output_dir=args.output_dir,
        author=args.author,
        license_id=args.license_id,
        license_evidence_url=args.license_evidence_url,
        attribution=args.attribution,
    )


def main() -> int:
    try:
        result = import_codex_pet(parse_args())
    except ConversionError as error:
        print(f"✗ 导入失败：{error}")
        return 1
    report = result["report"]
    assert isinstance(report, dict)
    files = report["files"]
    assert isinstance(files, dict)
    package = files["package"]
    assert isinstance(package, dict)
    print(
        "✓ 导入完成："
        f"{result['output_dir']}，"
        f"源包 {package['bytes']} 字节，"
        f"SHA-256 {package['sha256']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
