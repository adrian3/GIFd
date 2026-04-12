(function () {
  const imageList = document.getElementById("imageList");
  const viewerElement = document.getElementById("viewer");
  const strengthSlider = document.getElementById("strengthSlider");
  const strengthValue = document.getElementById("strengthValue");
  const viewerModeSelect = document.getElementById("viewerModeSelect");
  const saveGifButton = document.getElementById("saveGifButton");
  const gifSettingsButton = document.getElementById("gifSettingsButton");
  const uploadButton = document.getElementById("uploadButton");
  const uploadInput = document.getElementById("uploadInput");
  const dropZone = document.getElementById("dropZone");
  const gifSettingsDialog = document.getElementById("gifSettingsDialog");
  const gifPreviewDialog = document.getElementById("gifPreviewDialog");
  const gifPreviewTitle = document.getElementById("gifPreviewTitle");
  const gifPreviewSubtitle = document.getElementById("gifPreviewSubtitle");
  const gifPreviewProgress = document.getElementById("gifPreviewProgress");
  const gifPreviewImage = document.getElementById("gifPreviewImage");
  const gifPreviewStatus = document.getElementById("gifPreviewStatus");
  const gifPreviewSaveButton = document.getElementById("gifPreviewSaveButton");
  const gifPreviewSettingsButton = document.getElementById("gifPreviewSettingsButton");
  const gifColorModeInput = document.getElementById("gifColorModeInput");
  const gifFramesInput = document.getElementById("gifFramesInput");
  const gifSizeInput = document.getElementById("gifSizeInput");
  const gifDelayInput = document.getElementById("gifDelayInput");
  const gifColorsInput = document.getElementById("gifColorsInput");
  const gifDitheringModeInput = document.getElementById("gifDitheringModeInput");
  const gifDefaultsButton = document.getElementById("gifDefaultsButton");
  const gifSaveButton = document.getElementById("gifSaveButton");

  const GIF_SETTINGS_STORAGE_KEY = "gifSettings";
  const VIEWER_MODE_STORAGE_KEY = "viewerMode";
  const TRASH_ICON_PATH = "./images/app/trash.svg";
  const DEFAULT_STRENGTH_VALUE = 15;
  const defaultGifSettings = {
    frameCount: 18,
    maxDimension: 600,
    delay: 5,
    colorMode: "color",
    colors: 256,
    ditheringMode: "FloydSteinberg"
  };

  let images = [];
  let app;
  let container;
  let imageSprite;
  let depthSprite;
  let displacementFilter;
  let currentImage = null;
  let statusMessage = null;
  let strengthDivisor = Number(strengthSlider.value);
  let viewerMode = loadViewerMode();
  let gifSettings = loadGifSettings();
  let gifPreviewRequestId = 0;
  let currentGifPreview = null;
  let currentGifPreviewItem = null;
  let currentGifPreviewObjectUrl = null;
  let shouldRefreshPreviewAfterSettingsSave = false;

  initializeViewer();
  bindEvents();
  loadImages();

  function initializeUi() {
    imageList.innerHTML = "";
    images.forEach(function (item) {
      const isActive = Boolean(currentImage && currentImage.url === item.url);
      const row = document.createElement("div");
      row.className = "image-row";

      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "image-select-button" + (isActive ? " is-active" : "");
      selectButton.addEventListener("click", function () {
        setImage(item, true);
      });

      const name = document.createElement("span");
      name.className = "image-name";
      name.textContent = item.name;

      const thumbnail = document.createElement("img");
      thumbnail.className = "image-thumbnail";
      thumbnail.alt = item.name;
      thumbnail.loading = "lazy";
      thumbnail.src = item.thumbnail || item.image;

      selectButton.appendChild(thumbnail);
      selectButton.appendChild(name);

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "image-delete-button" + (isActive ? "" : " is-hidden");
      deleteButton.setAttribute("aria-label", 'Delete "' + item.name + '"');
      deleteButton.title = "Delete";
      const deleteIcon = document.createElement("img");
      deleteIcon.src = TRASH_ICON_PATH;
      deleteIcon.alt = "";
      deleteIcon.className = "delete-icon";
      deleteIcon.setAttribute("aria-hidden", "true");
      deleteButton.appendChild(deleteIcon);

      const actions = document.createElement("div");
      actions.className = "image-actions";

      deleteButton.addEventListener("click", function (event) {
        event.stopPropagation();
        deleteImage(item);
      });

      actions.appendChild(deleteButton);
      row.appendChild(selectButton);
      row.appendChild(actions);

      imageList.appendChild(row);
    });
  }

  function initializeViewer() {
    const viewportWidth = viewerElement.clientWidth || 800;
    const viewportHeight = viewerElement.clientHeight || 600;

    app = new PIXI.Application({
      width: viewportWidth,
      height: viewportHeight,
      backgroundAlpha: 0,
      transparent: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      antialias: true
    });

    viewerElement.appendChild(app.view);

    container = new PIXI.Container();
    app.stage.addChild(container);

    app.stage.interactive = true;
    app.stage.hitArea = new PIXI.Rectangle(0, 0, viewportWidth, viewportHeight);
    app.stage.on("pointermove", handlePointerMove);
    app.view.addEventListener("mouseleave", resetDisplacement);
  }

  function bindEvents() {
    updateStrengthValue();
    updateGifSettingsButtonIndicator();
    strengthSlider.addEventListener("input", function () {
      strengthDivisor = Number(strengthSlider.value);
      updateStrengthValue();
      resetDisplacement();
    });

    viewerModeSelect.value = getViewerModeSelectValue(viewerMode);
    viewerModeSelect.addEventListener("change", function () {
      viewerMode = normalizeViewerMode(viewerModeSelect.value);
      viewerModeSelect.value = getViewerModeSelectValue(viewerMode);
      persistViewerMode();
      resetDisplacement();
    });

    gifSettingsButton.addEventListener("click", function () {
      openGifSettings(false);
    });
    if (saveGifButton) {
      saveGifButton.addEventListener("click", function () {
        exportGif();
      });
    }
    gifDefaultsButton.addEventListener("click", resetGifSettingsToDefaults);
    gifSaveButton.addEventListener("click", saveGifSettingsFromDialog);
    gifPreviewSaveButton.addEventListener("click", saveGeneratedGif);
    if (gifPreviewSettingsButton) {
      gifPreviewSettingsButton.addEventListener("click", function () {
        openGifSettings(true);
      });
    }
    if (gifPreviewDialog) {
      gifPreviewDialog.addEventListener("close", clearGifPreview);
    }
    bindDialogBackdropClose(gifSettingsDialog);
    bindDialogBackdropClose(gifPreviewDialog);

    uploadButton.addEventListener("click", function () {
      uploadInput.click();
    });

    uploadInput.addEventListener("change", function (event) {
      const file = event.target.files && event.target.files[0];
      if (file) {
        uploadHeic(file);
      }
      uploadInput.value = "";
    });

    ["dragenter", "dragover"].forEach(function (eventName) {
      window.addEventListener(eventName, handleDragEnter);
    });

    ["dragleave", "drop"].forEach(function (eventName) {
      window.addEventListener(eventName, handleDragLeave);
    });

    window.addEventListener("drop", handleDrop);
    window.addEventListener("resize", refreshLayout);
  }

  function loadImages() {
    fetch("/api/images", { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Unable to load image catalog");
        }
        return response.json();
      })
      .then(function (data) {
        images = data;
        initializeUi();
        if (images.length > 0) {
          setImage(getInitialImage());
        }
      })
      .catch(function () {
        showStatus("Unable to load the image catalog. Start the local server with python3 server.py.");
      });
  }

  function getInitialImage() {
    const params = new URLSearchParams(window.location.search);
    const match = findByUrl(params.get("img"));
    return match || images[0];
  }

  function findByUrl(url) {
    return images.find(function (item) {
      return item.url === url;
    });
  }

  function addOrUpdateImage(item) {
    const index = images.findIndex(function (existing) {
      return existing.url === item.url;
    });

    if (index === -1) {
      images.push(item);
    } else {
      images[index] = item;
    }

    images.sort(function (left, right) {
      return left.id - right.id;
    });
    initializeUi();
  }

  function setImage(item, updateHistory) {
    if (!item) {
      return;
    }

    currentImage = item;
    initializeUi();
    showStatus("Loading images...");

    Promise.all([
      loadTextureFromImage(item.image),
      loadTextureFromImage(item.depthImage)
    ]).then(function (textures) {
      hideStatus();
      renderScene(textures[0], textures[1]);
    }).catch(function () {
      showStatus("Unable to load this image set. If you opened the file directly, try a simple local server.");
    });

    if (updateHistory) {
      updateQueryString(item.url);
    }
  }

  function updateQueryString(url) {
    if (window.location.protocol === "file:") {
      return;
    }

    const nextUrl = new URL(window.location.href);
    if (url) {
      nextUrl.searchParams.set("img", url);
    } else {
      nextUrl.searchParams.delete("img");
    }
    window.history.replaceState({}, "", nextUrl);
  }

  function showStatus(message) {
    if (!statusMessage) {
      statusMessage = document.createElement("div");
      statusMessage.style.position = "fixed";
      statusMessage.style.left = "50%";
      statusMessage.style.bottom = "22px";
      statusMessage.style.transform = "translateX(-50%)";
      statusMessage.style.zIndex = "25";
      statusMessage.style.padding = "10px 14px";
      statusMessage.style.border = "1px solid rgba(255,255,255,0.16)";
      statusMessage.style.borderRadius = "999px";
      statusMessage.style.background = "rgba(10, 15, 20, 0.88)";
      statusMessage.style.color = "#eef4fa";
      statusMessage.style.font = '14px "Avenir Next", "Segoe UI", sans-serif';
      document.body.appendChild(statusMessage);
    }

    statusMessage.textContent = message;
  }

  function handleDragEnter(event) {
    if (!containsFiles(event)) {
      return;
    }
    event.preventDefault();
    dropZone.classList.add("is-dragover");
  }

  function handleDragLeave(event) {
    if (event.type === "dragleave" && event.relatedTarget) {
      return;
    }
    dropZone.classList.remove("is-dragover");
  }

  function handleDrop(event) {
    if (!containsFiles(event)) {
      return;
    }

    event.preventDefault();
    dropZone.classList.remove("is-dragover");

    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) {
      uploadHeic(file);
    }
  }

  function containsFiles(event) {
    return event.dataTransfer && Array.from(event.dataTransfer.types || []).indexOf("Files") !== -1;
  }

  function uploadHeic(file) {
    if (!/\.heic$/i.test(file.name)) {
      showStatus("Please drop an iPhone spatial .HEIC file.");
      return;
    }

    showStatus("Importing " + file.name + "...");

    fetch("/api/upload", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name)
      },
      body: file
    })
      .then(function (response) {
        if (!response.ok) {
          return response.text().then(function (text) {
            try {
              const payload = JSON.parse(text);
              throw new Error(payload.error || "Upload failed");
            } catch (error) {
              if (error instanceof Error && error.message !== "Upload failed") {
                throw error;
              }
              throw new Error(text || "Upload failed");
            }
          });
        }
        return response.json();
      })
      .then(function (payload) {
        addOrUpdateImage(payload.item);
        setImage(payload.item, true);
        showStatus("Imported " + payload.item.name + " successfully.");
        window.setTimeout(hideStatus, 1800);
      })
      .catch(function (error) {
        showStatus(error.message || "Upload failed.");
      });
  }

  function deleteImage(item) {
    if (!window.confirm('Delete "' + item.name + '" and its depth map?')) {
      return;
    }

    showStatus("Deleting " + item.name + "...");

    fetch("/api/images/" + encodeURIComponent(item.url), {
      method: "DELETE"
    })
      .then(function (response) {
        if (!response.ok) {
          return response.text().then(function (text) {
            try {
              const payload = JSON.parse(text);
              throw new Error(payload.error || "Delete failed");
            } catch (error) {
              if (error instanceof Error && error.message !== "Delete failed") {
                throw error;
              }
              throw new Error(text || "Delete failed");
            }
          });
        }
        return response.json();
      })
      .then(function (payload) {
        images = payload.items;
        if (currentImage && currentImage.url === item.url) {
          currentImage = null;
          if (images.length > 0) {
            setImage(images[0], true);
          } else {
            container.removeChildren();
            updateQueryString("");
            hideStatus();
            initializeUi();
            return;
          }
        } else {
          initializeUi();
        }

        showStatus("Deleted " + item.name + ".");
        window.setTimeout(hideStatus, 1500);
      })
      .catch(function (error) {
        showStatus(error.message || "Delete failed.");
      });
  }

  function exportGif() {
    var item = arguments.length > 0 && arguments[0] ? arguments[0] : currentImage;
    if (!item) {
      showStatus("Select an image before exporting a GIF.");
      return;
    }

    openGifPreview(item);
  }

  function openGifPreview(item) {
    if (!item) {
      showStatus("Select an image before exporting a GIF.");
      return;
    }

    const settings = readGifSettings();
    const viewerStrength = getViewerGifStrength();
    const requestId = ++gifPreviewRequestId;
    currentGifPreviewItem = item;
    currentGifPreview = null;
    gifPreviewTitle.textContent = item.name + " gif preview";
    gifPreviewSubtitle.textContent = getViewerModeDisplayName(viewerMode) + " mode";
    gifPreviewStatus.textContent = "";
    gifPreviewProgress.style.display = "grid";
    gifPreviewImage.style.display = "none";
    gifPreviewImage.removeAttribute("src");
    gifPreviewSaveButton.disabled = true;
    clearGifPreviewObjectUrl();

    if (gifPreviewDialog && typeof gifPreviewDialog.showModal === "function" && !gifPreviewDialog.open) {
      gifPreviewDialog.showModal();
    }

    fetch("/api/export-gif/" + encodeURIComponent(item.url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        viewerStrength: viewerStrength,
        viewerMode: viewerMode,
        frameCount: settings.frameCount,
        maxDimension: settings.maxDimension,
        delay: settings.delay,
        colorMode: settings.colorMode,
        colors: settings.colors,
          ditheringMode: settings.ditheringMode
        })
    })
      .then(function (response) {
        if (!response.ok) {
          return response.text().then(function (text) {
            try {
              const payload = JSON.parse(text);
              throw new Error(payload.error || "GIF export failed");
            } catch (error) {
              if (error instanceof Error && error.message !== "GIF export failed") {
                throw error;
              }
              throw new Error(text || "GIF export failed");
            }
          });
        }
        return response.json();
      })
      .then(function (payload) {
        if (requestId !== gifPreviewRequestId) {
          return;
        }

        currentGifPreview = payload;
        return fetch(payload.url + "?v=" + Date.now(), { cache: "no-store" })
          .then(function (response) {
            if (!response.ok) {
              throw new Error("Unable to load the GIF preview.");
            }
            return response.blob();
          })
          .then(function (blob) {
            if (requestId !== gifPreviewRequestId) {
              return;
            }

            clearGifPreviewObjectUrl();
            currentGifPreviewObjectUrl = window.URL.createObjectURL(blob);

            const previewLoader = new Image();
            previewLoader.onload = function () {
              if (requestId !== gifPreviewRequestId) {
                return;
              }
              gifPreviewImage.src = currentGifPreviewObjectUrl;
              gifPreviewImage.style.display = "block";
              gifPreviewProgress.style.display = "none";
              gifPreviewStatus.textContent = "";
              gifPreviewSaveButton.disabled = false;
            };
            previewLoader.onerror = function () {
              if (requestId !== gifPreviewRequestId) {
                return;
              }
              gifPreviewProgress.style.display = "none";
              gifPreviewStatus.textContent = "Unable to load the GIF preview.";
              gifPreviewSaveButton.disabled = true;
            };
            previewLoader.src = currentGifPreviewObjectUrl;
          });
      })
      .catch(function (error) {
        if (requestId !== gifPreviewRequestId) {
          return;
        }
        gifPreviewProgress.style.display = "none";
        gifPreviewStatus.textContent = error.message || "GIF export failed.";
        gifPreviewSaveButton.disabled = true;
      });
  }

  function saveGeneratedGif() {
    if (!currentGifPreview || !currentGifPreviewItem || !currentGifPreviewObjectUrl) {
      showStatus("Generate a GIF preview first.");
      return;
    }

    const link = document.createElement("a");
    link.href = currentGifPreviewObjectUrl;
    link.download = currentGifPreview.downloadName || (currentGifPreviewItem.url + "_" + viewerMode + ".gif");
    document.body.appendChild(link);
    link.click();
    link.remove();
    showStatus("Saved " + link.download + ".");
    window.setTimeout(hideStatus, 1800);
  }

  function hideStatus() {
    if (statusMessage && statusMessage.parentNode) {
      statusMessage.parentNode.removeChild(statusMessage);
      statusMessage = null;
    }
  }

  function loadTextureFromImage(src) {
    return new Promise(function (resolve, reject) {
      const image = new Image();
      image.onload = function () {
        resolve(PIXI.Texture.from(image));
      };
      image.onerror = function () {
        reject(new Error("Image failed to load: " + src));
      };
      image.src = src;
    });
  }

  function renderScene(imageTexture, depthTexture) {
    container.removeChildren();

    imageSprite = new PIXI.Sprite(imageTexture);
    depthSprite = new PIXI.Sprite(depthTexture);
    displacementFilter = new PIXI.filters.DisplacementFilter(depthSprite);
    displacementFilter.padding = 40;
    displacementFilter.scale.set(0, 0);

    container.filters = [displacementFilter];
    container.addChild(imageSprite);
    container.addChild(depthSprite);

    fitSprites();
  }

  function fitSprites() {
    if (!imageSprite || !depthSprite) {
      return;
    }

    const viewportWidth = viewerElement.clientWidth;
    const viewportHeight = viewerElement.clientHeight;
    const imageAspect = imageSprite.texture.width / imageSprite.texture.height;
    const viewportAspect = viewportWidth / viewportHeight;

    imageSprite.position.set(0, 0);
    depthSprite.position.set(0, 0);
    imageSprite.scale.set(1, 1);
    depthSprite.scale.set(1, 1);

    if (viewportAspect >= imageAspect) {
      imageSprite.width = viewportWidth;
      depthSprite.width = viewportWidth;
      imageSprite.scale.y = imageSprite.scale.x;
      depthSprite.scale.y = depthSprite.scale.x;
      imageSprite.y = (viewportHeight - imageSprite.height) * 0.5;
      depthSprite.y = (viewportHeight - depthSprite.height) * 0.5;
    } else {
      imageSprite.height = viewportHeight;
      depthSprite.height = viewportHeight;
      imageSprite.scale.x = imageSprite.scale.y;
      depthSprite.scale.x = depthSprite.scale.y;
      imageSprite.x = (viewportWidth - imageSprite.width) * 0.5;
      depthSprite.x = (viewportWidth - depthSprite.width) * 0.5;
    }
  }

  function handlePointerMove(event) {
    if (!displacementFilter || !imageSprite) {
      return;
    }

    const global = event.data.global;
    const imageLeft = imageSprite.x;
    const imageTop = imageSprite.y;
    const imageRight = imageLeft + imageSprite.width;
    const imageBottom = imageTop + imageSprite.height;

    if (
      global.x < imageLeft ||
      global.x > imageRight ||
      global.y < imageTop ||
      global.y > imageBottom
    ) {
      resetDisplacement();
      return;
    }

    const imageCenterX = imageLeft + imageSprite.width * 0.5;
    const imageCenterY = imageTop + imageSprite.height * 0.5;
    const strengthMultiplier = strengthDivisor / DEFAULT_STRENGTH_VALUE;
    const x = (imageCenterX - global.x) * strengthMultiplier / DEFAULT_STRENGTH_VALUE;
    const y = (imageCenterY - global.y) * strengthMultiplier / DEFAULT_STRENGTH_VALUE;
    if (viewerMode === "pan") {
      displacementFilter.scale.set(x, 0);
      return;
    }

    if (viewerMode === "tilt") {
      displacementFilter.scale.set(0, y);
      return;
    }

    if (viewerMode === "diag-tl-br") {
      const diagonal = (x + y) * 0.5;
      displacementFilter.scale.set(diagonal, diagonal);
      return;
    }

    if (viewerMode === "diag-tr-bl") {
      const diagonal = (x - y) * 0.5;
      displacementFilter.scale.set(diagonal, -diagonal);
      return;
    }

    displacementFilter.scale.set(x, y);
  }

  function resetDisplacement() {
    if (displacementFilter) {
      displacementFilter.scale.set(0, 0);
    }
  }

  function refreshLayout() {
    if (app) {
      const viewportWidth = viewerElement.clientWidth;
      const viewportHeight = viewerElement.clientHeight;
      app.renderer.resize(viewportWidth, viewportHeight);
      app.stage.hitArea = new PIXI.Rectangle(0, 0, viewportWidth, viewportHeight);
    }
    fitSprites();
  }

  function openGifSettings(refreshPreviewOnSave) {
    shouldRefreshPreviewAfterSettingsSave = Boolean(refreshPreviewOnSave);
    syncGifDialogInputs();
    if (gifSettingsDialog && typeof gifSettingsDialog.showModal === "function") {
      gifSettingsDialog.showModal();
    }
  }

  function bindDialogBackdropClose(dialog) {
    if (!dialog) {
      return;
    }

    dialog.addEventListener("click", function (event) {
      if (event.target === dialog && dialog.open) {
        dialog.close("cancel");
      }
    });
  }

  function syncGifDialogInputs() {
    const settings = readGifSettings();
    gifFramesInput.value = String(settings.frameCount);
    gifSizeInput.value = String(settings.maxDimension);
    gifDelayInput.value = String(settings.delay);
    gifColorModeInput.value = settings.colorMode;
    gifColorsInput.value = String(settings.colors);
    gifDitheringModeInput.value = settings.ditheringMode;
    syncGifColorControls(settings.colorMode, settings.colors);
  }

  function resetGifSettingsToDefaults() {
    gifSettings = sanitizeGifSettings(defaultGifSettings);
    persistGifSettings();
    syncGifDialogInputs();
    updateGifSettingsButtonIndicator();
  }

  function saveGifSettingsFromDialog() {
    gifSettings = sanitizeGifSettings({
      frameCount: Number(gifFramesInput.value),
      maxDimension: Number(gifSizeInput.value),
      delay: Number(gifDelayInput.value),
      colorMode: gifColorModeInput.value,
      colors: Number(gifColorsInput.value),
      ditheringMode: gifDitheringModeInput.value
    });
    persistGifSettings();
    updateGifSettingsButtonIndicator();
    if (gifSettingsDialog && typeof gifSettingsDialog.close === "function") {
      gifSettingsDialog.close();
    }
    if (shouldRefreshPreviewAfterSettingsSave && currentGifPreviewItem) {
      openGifPreview(currentGifPreviewItem);
    }
    shouldRefreshPreviewAfterSettingsSave = false;
  }

  function sanitizeGifSettings(settings) {
    const colorMode = normalizeColorMode(settings.colorMode, settings.blackAndWhite);
    const colors = colorMode === "blackAndWhite"
      ? 2
      : clampNumber(settings.colors, 2, 256, defaultGifSettings.colors);

    return {
      frameCount: clampNumber(settings.frameCount, 8, 36, defaultGifSettings.frameCount),
      maxDimension: clampNumber(settings.maxDimension, 320, 1600, defaultGifSettings.maxDimension),
      delay: clampNumber(settings.delay, 2, 20, defaultGifSettings.delay),
      colorMode: colorMode,
      colors: colors,
      ditheringMode: normalizeDitheringMode(settings.ditheringMode, settings.dithering)
    };
  }

  function clampNumber(value, min, max, fallback) {
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return Math.max(min, Math.min(max, value));
  }

  function loadGifSettings() {
    try {
      const raw = window.localStorage.getItem(GIF_SETTINGS_STORAGE_KEY);
      if (!raw) {
        return sanitizeGifSettings(defaultGifSettings);
      }
      return sanitizeGifSettings(JSON.parse(raw));
    } catch (error) {
      return sanitizeGifSettings(defaultGifSettings);
    }
  }

  function persistGifSettings() {
    try {
      window.localStorage.setItem(GIF_SETTINGS_STORAGE_KEY, JSON.stringify(gifSettings));
    } catch (error) {
      // Ignore storage errors (Safari private mode, etc.)
    }
  }

  function readGifSettings() {
    if (!gifSettings) {
      gifSettings = sanitizeGifSettings(defaultGifSettings);
    }
    return sanitizeGifSettings(gifSettings);
  }

  function loadViewerMode() {
    try {
      const raw = window.localStorage.getItem(VIEWER_MODE_STORAGE_KEY);
      return normalizeViewerMode(raw);
    } catch (error) {
      return "default3d";
    }
  }

  function persistViewerMode() {
    try {
      window.localStorage.setItem(VIEWER_MODE_STORAGE_KEY, viewerMode);
    } catch (error) {
      // Ignore storage errors (Safari private mode, etc.)
    }
  }

  function normalizeViewerMode(mode) {
    const normalized = String(mode || "").trim().toLowerCase();
    if (normalized === "pan") {
      return "pan";
    }
    if (normalized === "tilt") {
      return "tilt";
    }
    if (normalized === "default3d") {
      return "default3d";
    }
    if (normalized === "diag-tl-br" || normalized === "diagtlbr") {
      return "diag-tl-br";
    }
    if (normalized === "diag-tr-bl" || normalized === "diagtrbl") {
      return "diag-tr-bl";
    }
    return "default3d";
  }

  function getViewerModeSelectValue(mode) {
    const normalized = normalizeViewerMode(mode);
    const optionValues = Array.from(viewerModeSelect.options).map(function (option) {
      return option.value;
    });

    if (optionValues.indexOf(normalized) !== -1) {
      return normalized;
    }

    if (normalized === "diag-tl-br" && optionValues.indexOf("diagTLBR") !== -1) {
      return "diagTLBR";
    }

    if (normalized === "diag-tr-bl" && optionValues.indexOf("diagTRBL") !== -1) {
      return "diagTRBL";
    }

    return "default3d";
  }

  function syncGifColorControls(mode, colorCount) {
    const colorMode = mode || gifColorModeInput.value;
    const isBlackAndWhite = colorMode === "blackAndWhite";
    gifColorsInput.disabled = isBlackAndWhite;
    if (isBlackAndWhite) {
      gifColorsInput.value = "2";
      return;
    }

    gifColorsInput.max = "256";
    gifColorsInput.value = String(colorCount || defaultGifSettings.colors);
  }

  gifColorModeInput.addEventListener("change", function () {
    if (gifColorModeInput.value === "blackAndWhite") {
      gifColorsInput.value = "2";
      gifColorsInput.disabled = true;
    } else {
      gifColorsInput.max = "256";
      gifColorsInput.value = "256";
      gifColorsInput.disabled = false;
    }
  });

  function normalizeColorMode(colorMode, legacyBlackAndWhite) {
    if (colorMode === "color" || colorMode === "grayscale" || colorMode === "blackAndWhite") {
      return colorMode;
    }

    if (legacyBlackAndWhite) {
      return "blackAndWhite";
    }

    return defaultGifSettings.colorMode;
  }

  function normalizeDitheringMode(mode, legacyDithering) {
    const allowedModes = ["None", "FloydSteinberg", "Riemersma", "Ordered", "Jarvis"];
    if (typeof mode === "string" && allowedModes.indexOf(mode) !== -1) {
      return mode;
    }

    if (legacyDithering === false) {
      return "None";
    }

    return defaultGifSettings.ditheringMode;
  }

  function getViewerGifStrength() {
    return Math.max(2, Math.min(40, Math.round((strengthDivisor / DEFAULT_STRENGTH_VALUE) * 6)));
  }

  function updateStrengthValue() {
    if (strengthValue) {
      strengthValue.textContent = strengthSlider.value;
    }
  }

  function updateGifSettingsButtonIndicator() {
    if (!gifSettingsButton) {
      return;
    }
    const settings = readGifSettings();
    const mode = settings.colorMode;
    const colors = mode === "blackAndWhite" ? 2 : settings.colors;
    let modeLabel = "Color";
    if (mode === "grayscale") {
      modeLabel = "Grayscale";
    }
    if (mode === "blackAndWhite") {
      modeLabel = "Black and White";
    }
    const tooltip =
      "Mode: " + modeLabel + "\n" +
      "Colors: " + colors + "\n" +
      "Dithering: " + settings.ditheringMode + "\n" +
      "Frames: " + settings.frameCount + "\n" +
      "Width: " + settings.maxDimension + "\n" +
      "Frame Duration: " + settings.delay + "ms";
    gifSettingsButton.dataset.tooltip = tooltip;
    gifSettingsButton.removeAttribute("title");
    gifSettingsButton.setAttribute("aria-label", "Gif settings details");
  }

  function clearGifPreview() {
    clearGifPreviewObjectUrl();
    currentGifPreview = null;
    currentGifPreviewItem = null;
    gifPreviewImage.style.display = "none";
    gifPreviewImage.removeAttribute("src");
    gifPreviewProgress.style.display = "grid";
    gifPreviewStatus.textContent = "";
    gifPreviewSaveButton.disabled = true;
  }

  function clearGifPreviewObjectUrl() {
    if (currentGifPreviewObjectUrl) {
      window.URL.revokeObjectURL(currentGifPreviewObjectUrl);
      currentGifPreviewObjectUrl = null;
    }
  }

  function getViewerModeDisplayName(mode) {
    if (mode === "pan") {
      return "Pan";
    }
    if (mode === "tilt") {
      return "Tilt";
    }
    if (mode === "diag-tl-br") {
      return "Top Left to Bottom Right";
    }
    if (mode === "diag-tr-bl") {
      return "Top Right to Bottom Left";
    }
    return "360°";
  }
})();
