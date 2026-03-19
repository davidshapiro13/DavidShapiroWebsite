(function () {
  const headerMarkup = `
    <header class="site-header">
      <div class="site-header-inner">
        <h1 class="site-title">David Shapiro</h1>
        <nav class="nav" aria-label="Primary">
          <a href="index.html" data-nav>Home</a>
          <a href="about.html" data-nav>About</a>
          <a href="filmmaking.html" data-nav>Filmmaking</a>
          <a href="acting.html" data-nav>Acting</a>
          <a href="comics.html" data-nav>Comics</a>
          <a href="computers.html" data-nav>Computers</a>
          <a href="contact.html" data-nav>Contact</a>
        </nav>
      </div>
    </header>
  `;

  const footerMarkup = `
    <footer class="site-footer">
      <div class="site-footer-inner">
        <p class="small-note">Copyright 2026 by David Shapiro</p>
        <div class="hero-socials" aria-label="Social links">
          <a class="hero-social-link" href="https://www.youtube.com/@DavidShapiroAdventures" target="_blank" rel="noopener" aria-label="YouTube">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M23.5 7.2a3 3 0 0 0-2.1-2.1C19.5 4.6 12 4.6 12 4.6s-7.5 0-9.4.5A3 3 0 0 0 .5 7.2 31.7 31.7 0 0 0 0 12a31.7 31.7 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.7 31.7 0 0 0 24 12a31.7 31.7 0 0 0-.5-4.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z"/>
            </svg>
          </a>
          <a class="hero-social-link" href="https://www.linkedin.com/in/david-shapiro01/" target="_blank" rel="noopener" aria-label="LinkedIn">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4.9 3.5a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8ZM2.8 9.6h4.2V21H2.8V9.6Zm6.6 0h4v1.6h.1a4.4 4.4 0 0 1 4-2.2c4.2 0 5 2.8 5 6.3V21h-4.2v-5c0-1.2 0-2.8-1.7-2.8s-2 1.3-2 2.7V21H9.4V9.6Z"/>
            </svg>
          </a>
          <a class="hero-social-link" href="https://www.instagram.com/davidshapiro1/" target="_blank" rel="noopener" aria-label="Instagram">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7.2 2h9.6A5.2 5.2 0 0 1 22 7.2v9.6a5.2 5.2 0 0 1-5.2 5.2H7.2A5.2 5.2 0 0 1 2 16.8V7.2A5.2 5.2 0 0 1 7.2 2Zm9.5 1.8H7.3a3.5 3.5 0 0 0-3.5 3.5v9.4a3.5 3.5 0 0 0 3.5 3.5h9.4a3.5 3.5 0 0 0 3.5-3.5V7.3a3.5 3.5 0 0 0-3.5-3.5ZM12 7.7a4.3 4.3 0 1 1 0 8.6 4.3 4.3 0 0 1 0-8.6Zm0 1.8a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm5.1-3a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z"/>
            </svg>
          </a>
        </div>
      </div>
    </footer>
  `;

  function setActiveNav(container) {
    const path = window.location.pathname.split("/").pop() || "index.html";
    const links = container.querySelectorAll("[data-nav]");
    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (href === path) {
        link.setAttribute("aria-current", "page");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-component='header']").forEach((node) => {
      node.innerHTML = headerMarkup;
      setActiveNav(node);
    });

    document.querySelectorAll("[data-component='footer']").forEach((node) => {
      node.innerHTML = footerMarkup;
    });
  });
})();
