// didja.dev's only script (the CSP allows no inline script). Everything it does is presentation:
// the hero's Quick View (clickable, and playing a short sequence by itself), the Mac demo playing
// its scenes once it is in view, the recording, things lighting up as they
// come into view, and the highlighter stroke drawing itself. With reduced motion, states still
// change but nothing animates (global.css).

const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- The hero's Quick View: click an item to tick it; "Yes" ticks the email -----------------------
// Once it is in view it plays by itself: a step ticks with what Didja saw, then it asks about the
// email. Anything you click stops that and leaves it to you. With reduced motion it waits for you.
const mock = document.querySelector('[data-mock]');
if (mock) {
  const items = [...mock.querySelectorAll('[data-item]')];
  const counts = [...mock.querySelectorAll('[data-count]')];
  const confirm = mock.querySelector('[data-confirm]');
  const render = () => {
    for (const item of items) {
      const done = item.getAttribute('aria-pressed') === 'true';
      item.querySelector('.item-meta').textContent = done ? item.dataset.done : item.dataset.open;
    }
    const open = String(items.filter((i) => i.getAttribute('aria-pressed') !== 'true').length);
    for (const c of counts) c.textContent = open;
    for (const group of mock.querySelectorAll('[data-group]')) {
      const n = group.querySelector('[data-group-done]');
      if (n) n.textContent = String(group.querySelectorAll('[aria-pressed="true"]').length);
    }
  };
  const tick = (item, on) => {
    item.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) { item.classList.add('just'); setTimeout(() => item.classList.remove('just'), 1400); }
    render();
  };
  const timers = [];
  const stop = () => { while (timers.length) clearTimeout(timers.pop()); };
  for (const item of items) {
    item.addEventListener('click', () => { stop(); tick(item, item.getAttribute('aria-pressed') !== 'true'); });
  }
  mock.querySelector('[data-yes]')?.addEventListener('click', () => {
    stop();
    const email = mock.querySelector('[data-item="d"]');
    if (email) tick(email, true);
    confirm?.classList.add('away');
  });
  mock.querySelector('[data-no]')?.addEventListener('click', () => { stop(); confirm?.classList.add('away'); });

  if (!still && confirm) {
    confirm.classList.add('away'); // it arrives during the sequence; its space stays, so nothing moves
    const play = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      play.disconnect();
      const auto = mock.querySelector('[data-auto]');
      if (auto) timers.push(setTimeout(() => tick(auto, true), 1600));
      timers.push(setTimeout(() => confirm.classList.remove('away'), 3400));
    }, { threshold: 0.5 });
    play.observe(mock);
  }
}

// --- The Mac demo ---------------------------------------------------------------------------------
/** Show what belongs to a scene: `data-in="a-b"` (or "a": from a on), and tasks done from `data-done`. */
function setScene(stage, scene) {
  stage.dataset.scene = String(scene);
  for (const el of stage.querySelectorAll('[data-in]')) {
    const [a, b] = el.dataset.in.split('-').map(Number);
    el.classList.toggle('on', scene >= a && (b === undefined || Number.isNaN(b) || scene <= b));
  }
  let open = 0;
  for (const task of stage.querySelectorAll('.task')) {
    const from = task.dataset.done ? Number(task.dataset.done) : Infinity;
    task.classList.toggle('done', scene >= from);
    task.classList.toggle('just', scene === from);
    if (scene < from) open++;
  }
  for (const c of stage.querySelectorAll('[data-open-count]')) c.textContent = String(open);
}

// Drawn at 1040 wide; scaled to whatever width it is given.
const stages = [...document.querySelectorAll('[data-stage]')];
const fit = (stage) => stage.style.setProperty('--s', String(stage.clientWidth / 1040));
const ro = new ResizeObserver((entries) => entries.forEach((e) => fit(e.target)));
for (const stage of stages) {
  fit(stage);
  ro.observe(stage);
  setScene(stage, Number(stage.dataset.scene || 0));
}

// The story: once you reach it, it plays itself, scene by scene, and loops; it pauses while out of
// view. A caption jumps to its scene; the button pauses and plays. With reduced motion it waits
// for Play (or a caption) instead of starting by itself.
const story = document.querySelector('[data-story]');
if (story) {
  const stage = story.querySelector('[data-stage]');
  const captions = [...story.querySelectorAll('[data-caption]')];
  const button = story.querySelector('[data-story-play]');
  const label = story.querySelector('[data-story-play-label]');
  const count = captions.length || 5;
  const SCENE_MS = 4200;
  const LAST_MS = 6500; // the nudge stays a little longer before it starts again
  let scene = 0;
  let playing = !still;
  let visible = false;
  let started = 0; // when the current scene began, on the performance clock
  let pausedAt = 0; // how far into the scene it was when it stopped
  const length = () => (scene === count - 1 ? LAST_MS : SCENE_MS);
  const show = (i) => {
    scene = (i + count) % count;
    started = performance.now();
    pausedAt = 0;
    setScene(stage, scene);
    captions.forEach((c, j) => c.classList.toggle('on', j === scene));
    story.style.setProperty('--story', (scene / count).toFixed(4));
  };
  const setPlaying = (on) => {
    if (on && !playing) started = performance.now() - pausedAt;
    if (!on && playing) pausedAt = performance.now() - started;
    playing = on;
    button?.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (label) label.textContent = on ? (button.dataset.pause ?? 'Pause') : (button.dataset.play ?? 'Play');
  };
  const frame = (now) => {
    if (playing && visible) {
      const t = now - started;
      if (t >= length()) show(scene + 1);
      else story.style.setProperty('--story', ((scene + t / length()) / count).toFixed(4));
    }
    requestAnimationFrame(frame);
  };
  new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting === visible) continue;
      if (playing) { if (e.isIntersecting) started = performance.now() - pausedAt; else pausedAt = performance.now() - started; }
      visible = e.isIntersecting;
    }
  }, { threshold: 0.45 }).observe(stage);
  if (button) {
    button.dataset.pause = label?.textContent ?? 'Pause';
    button.dataset.play = button.dataset.playLabel ?? 'Play';
    button.addEventListener('click', () => setPlaying(!playing));
  }
  captions.forEach((c, i) => c.addEventListener('click', () => show(i)));
  playing = !playing; setPlaying(!playing); // sets the button to match
  show(0);
  requestAnimationFrame(frame);
}

// --- Coming into view ---------------------------------------------------------------------------
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) { e.target.classList.add('in'); seen.unobserve(e.target); }
  }
}, { rootMargin: '0px 0px -12% 0px' });
document.querySelectorAll('[data-reveal]').forEach((el) => seen.observe(el));

// The recording plays while it is in view, unless you asked for less motion (then it waits for Play).
const films = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting && !still) e.target.play().catch(() => {});
    else if (!e.isIntersecting) e.target.pause();
  }
}, { threshold: 0.4 });
document.querySelectorAll('video[data-autoplay]').forEach((v) => films.observe(v));

// Headings light up from pencil to ink as they scroll up the page.
const lit = [...document.querySelectorAll('[data-light]')];
// The highlighter stroke draws as you scroll past it.
const strokes = [...document.querySelectorAll('[data-draw]')].map((path) => {
  const length = path.getTotalLength();
  path.style.strokeDasharray = `${length} ${length}`;
  path.style.strokeDashoffset = String(length);
  return { path, length };
});
let ticking = false;
const paint = () => {
  ticking = false;
  const h = window.innerHeight;
  for (const el of lit) {
    const r = el.getBoundingClientRect();
    const p = Math.min(Math.max((h * 0.92 - r.top) / (h * 0.45), 0), 1);
    el.style.setProperty('--lit', p.toFixed(3));
  }
  for (const { path, length } of strokes) {
    const r = path.ownerSVGElement.getBoundingClientRect();
    const p = Math.min(Math.max((h * 0.85 - r.top) / (r.height + h * 0.35), 0), 1);
    path.style.strokeDashoffset = String(length * (1 - p));
  }
};
const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(paint); } };
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll);
paint();
