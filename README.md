# GIF'd from Ade

A local web app for turning iPhone spatial `.HEIC` photos into interactive depth previews and animated GIFs.

The app extracts:
- a normalized JPG
- a depth map PNG
- a thumbnail JPG

Then it lets you preview depth motion in multiple directions and export GIFs with configurable settings.

## What it does

- Imports spatial HEIC files by button or drag/drop
- Extracts image + depth data from each HEIC
- Builds a thumbnail library with delete controls
- Shows a live pseudo-3D viewer with depth strength control
- Supports direction modes:
  - `360°`
  - `Pan (right/left)`
  - `Tilt (up/down)`
  - `Top left to bottom right`
  - `Top right to bottom left`
- Generates GIF previews and downloads final GIF files
- Stores GIF settings in local storage

## First-time setup (no Git required)

Use this if it is your first time running GIF'd and you do not want to install Git.

1. Download the project from GitHub:
   - Open the GIF'd GitHub page in your browser.
   - Click `Code` -> `Download ZIP`.
2. Unzip the download and open the extracted folder (for example `GIFd`).
3. Open Terminal and move into the project folder:

```bash
cd /path/to/GIFd
```

4. Install dependencies.
   - Required: `python3`, `heif-convert` (from `libheif`), `exiftool`, `magick` (ImageMagick)
   - Recommended: `ffmpeg` (not required by the current app, but useful for media workflows)

macOS (Homebrew):

```bash
brew install python libheif exiftool imagemagick ffmpeg
```

5. Verify your installs:

```bash
python3 --version
heif-convert --version
exiftool -ver
magick -version
ffmpeg -version
```

6. Start the local server:

```bash
python3 server.py
```

7. Open the app in your browser:

[http://127.0.0.1:4173][1]

8. Stop the app anytime with `Ctrl + C` in Terminal.

## Basic workflow

1. Upload a spatial `.HEIC` (or drag it into the window).
2. Select an image from the library.
3. Adjust `Depth strength` and `Direction`.
4. Click `Make GIF`.
5. In the preview modal, use the pencil button to open GIF settings.
6. Update settings to regenerate the preview.
7. Click `Save` when ready.

## File storage

- Bundled/static app assets: [`images/app/`][2]
- Demo starter images (seeded on first run): [`images/app/demo images/`][4]
- Imported/generated user assets: [`images/library/`][3]
- Local catalog metadata (not committed): `images/library/images.json`

## Project structure

```text
GIFd/
  index.html
  server.py
  README.md
  css/
    whisper.css
    styles.css
  js/
    app.js
    pixi.min.js
  images/
    app/
      demo images/
    library/
```

## Notes

- Run through `python3 server.py`; do not open `index.html` with `file://`.
- HEIC conversion depends on local native tools listed above.
- On first run, the app copies 3 demo image sets from `images/app/demo images/` into `images/library/`.
- `images/library/` is intended for local/runtime files and is ignored by Git (except `.gitkeep`).
- This is currently optimized for local use.

## Troubleshooting

- Upload fails:
  - confirm the file is a spatial `.HEIC`
  - confirm `heif-convert`, `exiftool`, and `magick` are installed
  - restart `server.py`
- Viewer loads but image/depth fails:
  - open the app from `http://127.0.0.1:4173`
- GIF output not as expected:
  - review mode, colors, dithering, frame count, width, and frame duration in GIF settings

[1]:	http://127.0.0.1:4173
[2]:	/Users/adehanft/Desktop/GIFd/images/app
[3]:	/Users/adehanft/Desktop/GIFd/images/library
[4]:	/Users/adehanft/Desktop/GIFd/images/app/demo images
