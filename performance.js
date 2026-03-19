(() => {
  const criticalSelectors = [
    ".hero-media--banner img",
    ".about-top-media img",
    ".hero-profile img",
    ".carousel-frame .carousel-image",
    ".carousel-frame img",
    ".computers-main-image"
  ];

  const isCriticalImage = (img) => criticalSelectors.some((selector) => img.matches(selector));

  const tuneImage = (img) => {
    if (!(img instanceof HTMLImageElement) || img.dataset.perfTuned === "1") return;

    if (isCriticalImage(img)) {
      img.loading = "eager";
      img.decoding = "sync";
    } else {
      if (!img.hasAttribute("loading")) img.loading = "lazy";
      if (!img.hasAttribute("decoding")) img.decoding = "async";
    }

    img.dataset.perfTuned = "1";
  };

  const tuneAllImages = () => {
    document.querySelectorAll("img").forEach(tuneImage);
  };

  const setTopFetchPriority = () => {
    const topImage = document.querySelector(
      ".hero-media--banner img, .about-top-media img, .carousel-frame .carousel-image, .computers-main-image, .hero-profile img"
    );
    if (topImage) topImage.fetchPriority = "high";
  };

  const observeNewImages = () => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLImageElement) {
            tuneImage(node);
          } else if (node instanceof Element) {
            node.querySelectorAll("img").forEach(tuneImage);
          }
        });
      });
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  const init = () => {
    tuneAllImages();
    setTopFetchPriority();
    observeNewImages();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
