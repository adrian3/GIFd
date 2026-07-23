#!/usr/bin/env python3

import json
import math
import pathlib
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import webbrowser
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


ROOT = pathlib.Path(__file__).resolve().parent
IMAGES_ROOT_DIR = ROOT / "images"
APP_IMAGES_DIR = IMAGES_ROOT_DIR / "app"
LIBRARY_IMAGES_DIR = IMAGES_ROOT_DIR / "library"
GIFS_IMAGES_DIR = IMAGES_ROOT_DIR / "gifs"
DEMO_IMAGES_DIR = APP_IMAGES_DIR / "demo images"
CATALOG_PATH = LIBRARY_IMAGES_DIR / "images.json"
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "4173"))
MAX_VIEWER_DIMENSION = 2048
GIF_FRAME_COUNT = 18
GIF_MAX_DIMENSION = 600
GIF_DELAY = 5
GIF_COLORS = 256
DEPTH_ALIGN_SCALE_X = 1.0
DEPTH_ALIGN_SCALE_Y = 1.0
DEPTH_ALIGN_OFFSET_X = 0.0
DEPTH_ALIGN_OFFSET_Y = 0.0
GIF_DISPLACEMENT_CALIBRATION = 0.42


def ensure_image_directories():
    APP_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    LIBRARY_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    GIFS_IMAGES_DIR.mkdir(parents=True, exist_ok=True)


def ensure_catalog_file():
    if not CATALOG_PATH.exists():
        save_catalog([])


def load_catalog():
    ensure_catalog_file()
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def save_catalog(items):
    CATALOG_PATH.write_text(json.dumps(items, indent=2) + "\n", encoding="utf-8")


def seed_demo_images_if_needed():
    ensure_catalog_file()
    items = load_catalog()
    if items:
        return

    demo_stems = ("demo-1", "demo-2", "demo-3")
    if not DEMO_IMAGES_DIR.exists():
        return

    for stem in demo_stems:
        source_image = DEMO_IMAGES_DIR / f"{stem}.jpg"
        source_thumbnail = DEMO_IMAGES_DIR / f"{stem}_thumb.jpg"
        source_depth = DEMO_IMAGES_DIR / f"{stem}_depth.png"
        if not source_image.exists() or not source_thumbnail.exists() or not source_depth.exists():
            return

    seeded_items = []
    for index, stem in enumerate(demo_stems):
        source_image = DEMO_IMAGES_DIR / f"{stem}.jpg"
        source_thumbnail = DEMO_IMAGES_DIR / f"{stem}_thumb.jpg"
        source_depth = DEMO_IMAGES_DIR / f"{stem}_depth.png"

        target_image = LIBRARY_IMAGES_DIR / f"{stem}.jpg"
        target_thumbnail = LIBRARY_IMAGES_DIR / f"{stem}_thumb.jpg"
        target_depth = LIBRARY_IMAGES_DIR / f"{stem}_depth.png"

        shutil.copy2(source_image, target_image)
        shutil.copy2(source_thumbnail, target_thumbnail)
        shutil.copy2(source_depth, target_depth)

        seeded_items.append({
            "id": index,
            "name": f"Demo {index + 1}",
            "comment": "Starter demo image. You can delete this at any time.",
            "url": stem,
            "image": catalog_path_for(target_image),
            "thumbnail": catalog_path_for(target_thumbnail),
            "depthImage": catalog_path_for(target_depth)
        })

    save_catalog(seeded_items)


def image_path_from_catalog(path_value):
    path_text = path_value.replace("./", "", 1)
    resolved = (ROOT / path_text).resolve()
    if ROOT.resolve() not in resolved.parents and resolved != ROOT.resolve():
        raise RuntimeError("Refusing to delete a file outside the project directory.")
    return resolved


def catalog_path_for(path):
    return f"./{path.relative_to(ROOT).as_posix()}"


def processed_depth_from_source(source_path, output_path, width, height):
    run_command([
        "magick",
        str(source_path),
        "-auto-level",
        "-filter",
        "Lanczos",
        "-resize",
        f"{width}x{height}!",
        str(output_path)
    ])


def read_reference_size(input_path):
    result = run_command([
        "exiftool",
        "-s",
        "-s",
        "-s",
        "-IntrinsicMatrixReferenceWidth",
        "-IntrinsicMatrixReferenceHeight",
        str(input_path)
    ])
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if len(lines) != 2:
        return None
    try:
        return int(lines[0]), int(lines[1])
    except ValueError:
        return None


def normalize_main_image(source_path, output_path, width, height):
    run_command([
        "magick",
        str(source_path),
        "-filter",
        "Lanczos",
        "-resize",
        f"{width}x{height}!",
        str(output_path)
    ])


def scale_dimensions(width, height, max_dimension):
    largest_edge = max(width, height)
    if largest_edge <= max_dimension:
        return width, height

    scale = max_dimension / largest_edge
    return max(1, round(width * scale)), max(1, round(height * scale))


def generate_thumbnail(source_path, output_path):
    run_command([
        "magick",
        str(source_path),
        "-auto-orient",
        "-thumbnail",
        "280x180^",
        "-gravity",
        "center",
        "-extent",
        "280x180",
        str(output_path)
    ])


def render_gif_frame(image_path, depth_path, output_path, x_offset, y_offset):
    run_command([
        "magick",
        str(image_path),
        str(depth_path),
        "-alpha",
        "off",
        "-compose",
        "displace",
        "-set",
        "option:compose:args",
        f"{x_offset}x{y_offset}",
        "-composite",
        str(output_path)
    ])


def align_depth_map(source_path, output_path, width, height):
    scaled_width = max(1, round(width * DEPTH_ALIGN_SCALE_X))
    scaled_height = max(1, round(height * DEPTH_ALIGN_SCALE_Y))
    x_offset = round(DEPTH_ALIGN_OFFSET_X * width)
    y_offset = round(DEPTH_ALIGN_OFFSET_Y * height)

    run_command([
        "magick",
        str(source_path),
        "-filter",
        "Lanczos",
        "-resize",
        f"{scaled_width}x{scaled_height}!",
        "-gravity",
        "center",
        "-background",
        "black",
        "-extent",
        f"{width}x{height}{x_offset:+d}{y_offset:+d}",
        str(output_path)
    ])


def finalize_gif(source_path, output_path, color_mode, colors, dithering_mode):
    if color_mode == "blackAndWhite":
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = pathlib.Path(temp_dir)
            intermediate_path = temp_path / "bw_intermediate.gif"
            palette_path = temp_path / "bw_palette.png"

            command = [
                "magick",
                str(source_path),
                "-coalesce",
                "-background",
                "white",
                "-alpha",
                "remove",
                "-alpha",
                "off",
                "-colorspace",
                "Gray",
                "-auto-level"
            ]

            if dithering_mode == "Ordered":
                command.extend(["-ordered-dither", "o8x8"])
            elif dithering_mode and dithering_mode != "None":
                command.extend(["-dither", dithering_mode])
            else:
                command.append("+dither")

            command.extend([
                "-colors",
                "2",
                "-layers",
                "Optimize",
                str(intermediate_path)
            ])
            run_command(command)

            if dithering_mode == "Ordered":
                shutil.copy2(intermediate_path, output_path)
                return

            run_command([
                "magick",
                "xc:#000000",
                "xc:#ffffff",
                "+append",
                str(palette_path)
            ])

            run_command([
                "magick",
                str(intermediate_path),
                "+dither",
                "-remap",
                str(palette_path),
                "-alpha",
                "off",
                str(output_path)
            ])
        return

    command = [
        "magick",
        str(source_path),
        "-coalesce",
        "-background",
        "white",
        "-alpha",
        "remove",
        "-alpha",
        "off"
    ]
    apply_global_dither = True

    if color_mode == "grayscale":
        command.extend(["-colorspace", "Gray", "-colors", str(colors)])
    else:
        command.extend(["-colors", str(colors)])

    if apply_global_dither:
        if dithering_mode and dithering_mode != "None":
            command.extend(["-dither", dithering_mode])
        else:
            command.append("+dither")

    command.extend([
        "-layers",
        "Optimize",
        str(output_path)
    ])
    run_command(command)


def normalize_color_mode(color_mode, legacy_black_and_white):
    if color_mode in ("color", "grayscale", "blackAndWhite"):
        return color_mode

    if legacy_black_and_white:
        return "blackAndWhite"

    return "color"


def extract_heif_image_and_depth(input_path, temp_path):
    output_prefix = temp_path / "converted.jpg"
    run_command(["heif-convert", "--with-aux", str(input_path), str(output_prefix)], cwd=temp_path)

    depth_candidates = sorted(temp_path.glob("converted-*-depth.*"))
    if not depth_candidates:
        raise RuntimeError("The uploaded HEIC did not expose a depth image.")

    depth_source = max(depth_candidates, key=image_area)
    paired_image = depth_source.with_name(depth_source.name.replace("-depth", ""))
    if not paired_image.exists():
        raise RuntimeError("Could not find the main image paired with the extracted depth map.")

    return paired_image, depth_source


def run_command(args, cwd=None):
    return subprocess.run(
        args,
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True
    )


def read_request_body(handler):
    transfer_encoding = (handler.headers.get("Transfer-Encoding") or "").lower()
    if "chunked" in transfer_encoding:
        body = bytearray()
        while True:
            line = handler.rfile.readline().strip()
            if not line:
                continue

            chunk_size = int(line.split(b";", 1)[0], 16)
            if chunk_size == 0:
                while True:
                    trailer = handler.rfile.readline()
                    if trailer in (b"\r\n", b"\n", b""):
                        break
                break

            body.extend(handler.rfile.read(chunk_size))
            handler.rfile.read(2)
        return bytes(body)

    content_length = int(handler.headers.get("Content-Length", "0"))
    if content_length <= 0:
        return b""
    return handler.rfile.read(content_length)


def slugify(text):
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "imported-photo"


def title_from_stem(stem):
    return re.sub(r"[_-]+", " ", stem).strip().title() or "Imported Photo"


def unique_slug(base_slug, items):
    used = {item["url"] for item in items}
    if base_slug not in used:
        return base_slug

    suffix = 2
    while f"{base_slug}-{suffix}" in used:
        suffix += 1
    return f"{base_slug}-{suffix}"


def next_id(items):
    if not items:
        return 0
    return max(item["id"] for item in items) + 1


def find_item_by_url(url):
    items = load_catalog()
    item = next((entry for entry in items if entry["url"] == url), None)
    if item is None:
        raise RuntimeError("Image not found.")
    return item


def image_area(path):
    output = run_command([
        "magick",
        "identify",
        "-format",
        "%w %h",
        str(path)
    ]).stdout.strip()
    width, height = output.split()
    return int(width) * int(height)


def normalize_viewer_mode(viewer_mode):
    normalized = str(viewer_mode or "").strip().lower()
    if normalized in ("default3d", "pan", "tilt"):
        return normalized
    if normalized in ("diag-tl-br", "diagtlbr"):
        return "diag-tl-br"
    if normalized in ("diag-tr-bl", "diagtrbl"):
        return "diag-tr-bl"
    return "default3d"


def viewer_mode_label(viewer_mode):
    if viewer_mode == "pan":
        return "pan"
    if viewer_mode == "tilt":
        return "tilt"
    if viewer_mode == "diag-tl-br":
        return "diag-tl-br"
    if viewer_mode == "diag-tr-bl":
        return "diag-tr-bl"
    return "3d"


def gif_color_label(color_mode, colors):
    if color_mode == "blackAndWhite":
        return "bw"
    if color_mode == "grayscale":
        return f"gray{colors}"
    return f"color{colors}"


def build_gif_offsets(frame_count, strength, viewer_mode):
    offsets = []
    for index in range(frame_count):
        progress = index / max(1, frame_count - 1)
        angle = progress * 2 * math.pi
        if viewer_mode == "pan":
            offsets.append((round(strength * math.sin(angle), 2), 0))
        elif viewer_mode == "tilt":
            offsets.append((0, round((strength * 0.45) * math.sin(angle), 2)))
        elif viewer_mode == "diag-tl-br":
            diagonal = round(strength * math.sin(angle), 2)
            offsets.append((diagonal, diagonal))
        elif viewer_mode == "diag-tr-bl":
            diagonal = round(strength * math.sin(angle), 2)
            offsets.append((diagonal, -diagonal))
        else:
            offsets.append((
                round(strength * math.sin(angle), 2),
                round((strength * 0.45) * math.cos(angle), 2)
            ))
    return offsets


def export_parallax_gif(url, settings):
    item = find_item_by_url(url)
    image_path = image_path_from_catalog(item["image"])
    depth_path = image_path_from_catalog(item["depthImage"])
    strength = max(0.1, min(float(settings.get("viewerStrength", settings.get("strength", 2.5))), 10.0))
    strength = round(strength * GIF_DISPLACEMENT_CALIBRATION, 3)
    viewer_mode = normalize_viewer_mode(settings.get("viewerMode"))
    mode_label = viewer_mode_label(viewer_mode)
    frame_count = max(8, min(int(settings.get("frameCount", GIF_FRAME_COUNT)), 36))
    max_dimension = max(320, min(int(settings.get("maxDimension", GIF_MAX_DIMENSION)), 1600))
    delay = max(2, min(int(settings.get("delay", GIF_DELAY)), 20))
    color_mode = normalize_color_mode(settings.get("colorMode"), settings.get("blackAndWhite"))
    colors = max(2, min(int(settings.get("colors", GIF_COLORS)), 256))
    color_label = gif_color_label(color_mode, colors)
    gif_filename = f"{item['url']}_{mode_label}_w{max_dimension}_{color_label}.gif"
    gif_path = GIFS_IMAGES_DIR / gif_filename
    dithering_mode = settings.get("ditheringMode", "FloydSteinberg")
    width, height = scale_dimensions(*read_image_size(image_path), max_dimension)

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = pathlib.Path(temp_dir)
        prepared_image = temp_path / "image.png"
        prepared_depth = temp_path / "depth.png"
        aligned_depth = temp_path / "depth_aligned.png"

        normalize_main_image(image_path, prepared_image, width, height)
        processed_depth_from_source(depth_path, prepared_depth, width, height)
        align_depth_map(prepared_depth, aligned_depth, width, height)

        frame_paths = []
        for index, (x_offset, y_offset) in enumerate(build_gif_offsets(frame_count, strength, viewer_mode)):
            frame_path = temp_path / f"frame_{index:02d}.png"
            render_gif_frame(prepared_image, aligned_depth, frame_path, x_offset, y_offset)
            frame_paths.append(frame_path)

        raw_gif = temp_path / "raw.gif"
        delay_arg = str(delay)
        command = ["magick"]
        for frame_path in frame_paths:
            command.extend(["-delay", delay_arg, str(frame_path)])
        command.extend(["-loop", "0", str(raw_gif)])
        run_command(command)
        finalize_gif(raw_gif, gif_path, color_mode, colors, dithering_mode)

    return {"url": catalog_path_for(gif_path), "downloadName": gif_path.name}


def read_image_size(path):
    output = run_command([
        "magick",
        "identify",
        "-format",
        "%w %h",
        str(path)
    ]).stdout.strip()
    width, height = output.split()
    return int(width), int(height)


def convert_spatial_heic(input_path, original_name):
    items = load_catalog()
    stem = pathlib.Path(original_name).stem
    base_slug = slugify(stem)
    slug = unique_slug(base_slug, items)
    display_name = title_from_stem(stem)

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = pathlib.Path(temp_dir)
        main_jpg, raw_depth_source = extract_heif_image_and_depth(input_path, temp_path)
        main_size = run_command([
            "magick",
            "identify",
            "-format",
            "%w %h",
            str(main_jpg)
        ]).stdout.strip()
        main_width, main_height = main_size.split()
        reference_size = read_reference_size(input_path)
        if reference_size is not None:
            target_width, target_height = reference_size
        else:
            target_width, target_height = int(main_width), int(main_height)
        target_width, target_height = scale_dimensions(
            target_width,
            target_height,
            MAX_VIEWER_DIMENSION
        )

        normalized_main_jpg = temp_path / "normalized_main.jpg"
        depth_png = temp_path / "depth.png"
        thumbnail_jpg = temp_path / "thumbnail.jpg"

        normalize_main_image(main_jpg, normalized_main_jpg, target_width, target_height)
        processed_depth_from_source(raw_depth_source, depth_png, target_width, target_height)
        generate_thumbnail(normalized_main_jpg, thumbnail_jpg)

        ensure_image_directories()
        final_jpg = LIBRARY_IMAGES_DIR / f"{slug}.jpg"
        final_depth = LIBRARY_IMAGES_DIR / f"{slug}_depth.png"
        final_thumbnail = LIBRARY_IMAGES_DIR / f"{slug}_thumb.jpg"
        final_heic = LIBRARY_IMAGES_DIR / f"{slug}.HEIC"

        shutil.copy2(input_path, final_heic)
        shutil.copy2(normalized_main_jpg, final_jpg)
        shutil.copy2(depth_png, final_depth)
        shutil.copy2(thumbnail_jpg, final_thumbnail)

    item = {
        "id": next_id(items),
        "name": display_name,
        "comment": f"Spatial photo extracted from {original_name}",
        "url": slug,
        "image": catalog_path_for(final_jpg),
        "thumbnail": catalog_path_for(final_thumbnail),
        "depthImage": catalog_path_for(final_depth),
        "sourceHeic": catalog_path_for(final_heic)
    }
    items.append(item)
    save_catalog(items)
    return item


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if self.path == "/api/images":
            payload = json.dumps(load_catalog()).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/upload":
            self.handle_upload()
            return

        if self.path.startswith("/api/export-gif/"):
            self.handle_export_gif()
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    def handle_upload(self):
        encoded_name = self.headers.get("X-Filename", "")
        filename = pathlib.Path(urllib.parse.unquote(encoded_name)).name

        if not filename:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"error": "Missing filename header."})
            return

        if not filename.lower().endswith(".heic"):
            self.respond_json(HTTPStatus.BAD_REQUEST, {"error": "Please upload a .HEIC file."})
            return

        body = read_request_body(self)

        if not body:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"error": "The uploaded file was empty."})
            return

        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_input = pathlib.Path(temp_dir) / filename
                temp_input.write_bytes(body)
                item = convert_spatial_heic(temp_input, filename)
        except subprocess.CalledProcessError as error:
            stderr = error.stderr.strip() or error.stdout.strip() or str(error)
            self.respond_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": stderr})
            return
        except Exception as error:
            self.respond_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(error)})
            return

        self.respond_json(HTTPStatus.OK, {"item": item})

    def handle_export_gif(self):
        prefix = "/api/export-gif/"
        url = urllib.parse.unquote(self.path[len(prefix):])
        if not url:
            self.respond_json(HTTPStatus.BAD_REQUEST, {"error": "Missing image url."})
            return

        try:
            body = read_request_body(self)
            payload = json.loads(body.decode("utf-8")) if body else {}
            result = export_parallax_gif(url, payload)
        except subprocess.CalledProcessError as error:
            stderr = error.stderr.strip() or error.stdout.strip() or str(error)
            self.respond_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": stderr})
            return
        except Exception as error:
            self.respond_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(error)})
            return

        self.respond_json(HTTPStatus.OK, result)

    def do_DELETE(self):
        prefix = "/api/images/"
        if not self.path.startswith(prefix):
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")
            return

        url = urllib.parse.unquote(self.path[len(prefix):])
        items = load_catalog()
        item = next((entry for entry in items if entry["url"] == url), None)
        if item is None:
            self.respond_json(HTTPStatus.NOT_FOUND, {"error": "Image not found."})
            return

        try:
            image_path = image_path_from_catalog(item["image"])
            depth_path = image_path_from_catalog(item["depthImage"])
            thumbnail_path = image_path_from_catalog(item["thumbnail"]) if item.get("thumbnail") else None
            source_heic_path = image_path_from_catalog(item["sourceHeic"]) if item.get("sourceHeic") else None
            image_dir = image_path.parent
            gif_paths = [
                image_dir / f"{item['url']}_3d.gif",
                image_dir / f"{item['url']}_pan.gif",
                image_dir / f"{item['url']}_tilt.gif",
                image_dir / f"{item['url']}_parallax.gif"
            ]
            gif_paths.extend(GIFS_IMAGES_DIR.glob(f"{item['url']}_*.gif"))
            if image_path.exists():
                image_path.unlink()
            if depth_path.exists():
                depth_path.unlink()
            if thumbnail_path and thumbnail_path.exists():
                thumbnail_path.unlink()
            if source_heic_path and source_heic_path.exists():
                source_heic_path.unlink()
            for gif_path in gif_paths:
                if gif_path.exists():
                    gif_path.unlink()
        except Exception as error:
            self.respond_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(error)})
            return

        remaining_items = [entry for entry in items if entry["url"] != url]
        save_catalog(remaining_items)
        self.respond_json(HTTPStatus.OK, {"items": remaining_items})

    def respond_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format_string, *args):
        print(format_string % args)


def main():
    ensure_image_directories()
    seed_demo_images_if_needed()
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"Serving Depth3DViewer at http://{HOST}:{PORT}")
    app_url = f"http://{HOST}:{PORT}/app.html"
    print(f"Open the full app at {app_url}")
    print("Drop a spatial HEIC onto the app page to import it.")
    try:
        webbrowser.open(app_url, new=2)
    except Exception:
        pass
    server.serve_forever()


if __name__ == "__main__":
    main()
