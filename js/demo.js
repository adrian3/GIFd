(function () {
  const imageList = document.getElementById("imageList");
  const viewerElement = document.getElementById("viewer");
  const strengthSlider = document.getElementById("strengthSlider");
  const strengthValue = document.getElementById("strengthValue");
  const viewerModeSelect = document.getElementById("viewerModeSelect");
  const exampleGifButton = document.getElementById("exampleGifButton");
  const exampleGifDialog = document.getElementById("exampleGifDialog");
  const exampleGifTitle = document.getElementById("exampleGifTitle");
  const exampleGifProgress = document.getElementById("exampleGifProgress");
  const exampleGifImage = document.getElementById("exampleGifImage");
  const exampleGifStatus = document.getElementById("exampleGifStatus");

  const VIEWER_MODE_STORAGE_KEY = "viewerMode";
  const DEFAULT_STRENGTH_VALUE = 15;
  const DEMO_IMAGES = [
    {
      id: 0,
      name: "Demo 1",
      url: "demo-1",
      image: "./images/app/demo%20images/demo-1.jpg",
      thumbnail: "./images/app/demo%20images/demo-1_thumb.jpg",
      depthImage: "./images/app/demo%20images/demo-1_depth.png"
    },
    {
      id: 1,
      name: "Demo 2",
      url: "demo-2",
      image: "./images/app/demo%20images/demo-2.jpg",
      thumbnail: "./images/app/demo%20images/demo-2_thumb.jpg",
      depthImage: "./images/app/demo%20images/demo-2_depth.png"
    },
    {
      id: 2,
      name: "Demo 3",
      url: "demo-3",
      image: "./images/app/demo%20images/demo-3.jpg",
      thumbnail: "./images/app/demo%20images/demo-3_thumb.jpg",
      depthImage: "./images/app/demo%20images/demo-3_depth.png"
    }
  ];

  let images = DEMO_IMAGES.slice();
  let app;
  let container;
  let imageSprite;
  let depthSprite;
  let displacementFilter;
  let currentImage = null;
  let statusMessage = null;
  let strengthDivisor = Number(strengthSlider.value);
  let viewerMode = loadViewerMode();

  initializeViewer();
  bindEvents();
  initializeUi();
  setImage(getInitialImage());

  function bindEvents() {
    updateStrengthValue();
    strengthSlider.addEventListener("input", function () {
      strengthDivisor = Number(strengthSlider.value);
      updateStrengthValue();
      resetDisplacement();
    });

    viewerModeSelect.value = normalizeViewerMode(viewerMode);
    viewerModeSelect.addEventListener("change", function () {
      viewerMode = normalizeViewerMode(viewerModeSelect.value);
      viewerModeSelect.value = viewerMode;
      persistViewerMode();
      resetDisplacement();
    });

    exampleGifButton.addEventListener("click", function () {
      openExampleGif();
    });
    bindDialogBackdropClose(exampleGifDialog);

    window.addEventListener("resize", refreshLayout);
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

  function initializeUi() {
    imageList.innerHTML = "";
    images.forEach(function (item) {
      const row = document.createElement("div");
      row.className = "image-row";

      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "image-select-button" + (currentImage && currentImage.url === item.url ? " is-active" : "");
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
      row.appendChild(selectButton);
      imageList.appendChild(row);
    });
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
    ])
      .then(function (textures) {
        hideStatus();
        renderScene(textures[0], textures[1]);
      })
      .catch(function () {
        showStatus("Unable to load this demo image set.");
      });

    if (updateHistory) {
      updateQueryString(item.url);
    }
  }

  function openExampleGif() {
    if (!currentImage) {
      showStatus("No example GIF available.");
      return;
    }

    const modeLabel = getViewerModeLabel(viewerMode);
    const modeSuffix = getViewerModeFileSuffix(viewerMode);
    const exampleGifPath = "./images/app/demo%20images/" + currentImage.url + "_example_" + modeSuffix + ".gif";

    exampleGifTitle.textContent = currentImage.name + " example GIF (" + modeLabel + ")";
    exampleGifStatus.textContent = "";
    exampleGifProgress.style.display = "grid";
    exampleGifImage.style.display = "none";
    exampleGifImage.removeAttribute("src");

    if (exampleGifDialog && typeof exampleGifDialog.showModal === "function" && !exampleGifDialog.open) {
      exampleGifDialog.showModal();
    }

    const gifUrl = exampleGifPath + "?v=" + Date.now();
    const gifLoader = new Image();
    gifLoader.onload = function () {
      exampleGifImage.src = gifUrl;
      exampleGifImage.style.display = "block";
      exampleGifProgress.style.display = "none";
      exampleGifStatus.textContent = "";
    };
    gifLoader.onerror = function () {
      exampleGifProgress.style.display = "none";
      exampleGifStatus.textContent = "Unable to load the example GIF for this image.";
    };
    gifLoader.src = gifUrl;
  }

  function getViewerModeFileSuffix(mode) {
    const normalized = normalizeViewerMode(mode);
    if (normalized === "pan") {
      return "pan";
    }
    if (normalized === "tilt") {
      return "tilt";
    }
    if (normalized === "diag-tl-br") {
      return "diag-tl-br";
    }
    if (normalized === "diag-tr-bl") {
      return "diag-tr-bl";
    }
    return "3d";
  }

  function getViewerModeLabel(mode) {
    const normalized = normalizeViewerMode(mode);
    if (normalized === "pan") {
      return "Pan";
    }
    if (normalized === "tilt") {
      return "Tilt";
    }
    if (normalized === "diag-tl-br") {
      return "Top left to bottom right";
    }
    if (normalized === "diag-tr-bl") {
      return "Top right to bottom left";
    }
    return "360°";
  }

  function getInitialImage() {
    const params = new URLSearchParams(window.location.search);
    const targetUrl = params.get("img");
    return images.find(function (item) {
      return item.url === targetUrl;
    }) || images[0];
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

  function updateStrengthValue() {
    strengthValue.textContent = strengthSlider.value;
  }

  function normalizeViewerMode(mode) {
    const normalized = String(mode || "").trim().toLowerCase();
    if (normalized === "pan") {
      return "pan";
    }
    if (normalized === "tilt") {
      return "tilt";
    }
    if (normalized === "diag-tl-br" || normalized === "diagtlbr") {
      return "diag-tl-br";
    }
    if (normalized === "diag-tr-bl" || normalized === "diagtrbl") {
      return "diag-tr-bl";
    }
    return "default3d";
  }

  function loadViewerMode() {
    try {
      return normalizeViewerMode(window.localStorage.getItem(VIEWER_MODE_STORAGE_KEY));
    } catch (error) {
      return "default3d";
    }
  }

  function persistViewerMode() {
    try {
      window.localStorage.setItem(VIEWER_MODE_STORAGE_KEY, viewerMode);
    } catch (error) {
      // Ignore storage errors.
    }
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

  function hideStatus() {
    if (statusMessage && statusMessage.parentNode) {
      statusMessage.parentNode.removeChild(statusMessage);
      statusMessage = null;
    }
  }
})();
