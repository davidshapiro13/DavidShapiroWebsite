// Decode the next photo before crossfading; measure dwell time from its reveal.
window.startPhotoCarousel = function ({ images, first, second, caption }) {
  if (!first || !second || images.length < 2) return;
  let current = first, spare = second, timer, generation = 0;
  let index = images.findIndex(item => item.src === first.getAttribute('src'));
  if (index < 0) index = 0;
  if (caption) caption.textContent = images[index].caption || '';
  const schedule = () => {
    clearTimeout(timer);
    if (!document.hidden) timer = setTimeout(advance, 5800);
  };
  async function advance() {
    const ticket = ++generation;
    const nextIndex = (index + 1) % images.length;
    const next = images[nextIndex];
    const preload = new Image();
    preload.src = next.src;
    try {
      await preload.decode();
      if (ticket !== generation || document.hidden) return;
      spare.loading = 'eager';
      spare.src = next.src;
      await spare.decode();
      if (ticket !== generation || document.hidden) return;
      spare.classList.add('is-active');
      current.classList.remove('is-active');
      if (caption) caption.textContent = next.caption || '';
      [current, spare] = [spare, current];
      index = nextIndex;
    } catch {
      // Keep the current photo visible and skip a failed asset on the next attempt.
      if (ticket === generation) index = nextIndex;
    }
    if (ticket === generation) schedule();
  }
  document.addEventListener('visibilitychange', () => {
    generation++;
    clearTimeout(timer);
    if (!document.hidden) schedule();
  });
  // The initially visible photo also gets a full dwell after it has decoded.
  first.decode().catch(() => {}).then(schedule);
};
