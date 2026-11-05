(() => {
  const question = document.querySelector('#question');
  const composer = document.querySelector('.composer');
  if (!question || !composer) return;
  const root = document.documentElement;
  let pending = false;
  const alignEditor = () => {
    pending = false;
    const editing = composer.contains(document.activeElement);
    if (!matchMedia('(max-width: 650px)').matches || !editing) {
      root.style.removeProperty('--ime-space');
      return;
    }
    const viewport = window.visualViewport;
    const height = viewport ? viewport.height : innerHeight;
    const top = viewport ? viewport.offsetTop : 0;
    root.style.setProperty('--ime-space', `${Math.max(0, innerHeight - height)}px`);
    const box = composer.getBoundingClientRect();
    const visibleBottom = top + height - 12;
    if (box.bottom > visibleBottom) {
      window.scrollBy({top: box.bottom - visibleBottom, behavior: 'instant'});
    } else if (box.top < top + 12) {
      window.scrollBy({top: box.top - top - 12, behavior: 'instant'});
    }
  };
  const schedule = () => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(alignEditor);
    }
  };
  composer.addEventListener('focusin', schedule);
  composer.addEventListener('focusout', schedule);
  window.addEventListener('resize', schedule, {passive:true});
  window.visualViewport?.addEventListener('resize', schedule, {passive:true});
})();