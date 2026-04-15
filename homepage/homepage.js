const revealElements = document.querySelectorAll('[data-reveal]');
const yearElements = document.querySelectorAll('[data-year]');
const copyButtons = document.querySelectorAll('[data-copy]');
const demoValue = document.querySelector('[data-demo-value]');
const demoNote = document.querySelector('[data-demo-note]');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const demoItems = [
  {
    value: 'Hello! How can I help you today?',
    note: 'Type a trigger once and let TypeWise expand it everywhere you write.'
  },
  {
    value: 'Today is ' + new Date().toLocaleDateString(),
    note: 'Dynamic variables keep your snippets current without manual edits.'
  },
  {
    value: 'Be right back. I am finishing something in TypeWise.',
    note: 'Reusable replies help you move faster in support, sales, and daily communication.'
  }
];

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );

  revealElements.forEach((element) => {
    element.classList.add('reveal');
    observer.observe(element);
  });
} else {
  revealElements.forEach((element) => element.classList.add('is-visible'));
}

yearElements.forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

copyButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const text = button.getAttribute('data-copy');
    const originalLabel = button.textContent;

    if (!text || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
      setTimeout(() => {
        button.textContent = originalLabel || 'Copy';
      }, 1600);
    } catch {
      button.textContent = 'Copy failed';
      setTimeout(() => {
        button.textContent = originalLabel || 'Copy';
      }, 1600);
    }
  });
});

if (demoValue && demoNote && !prefersReducedMotion) {
  let currentIndex = 0;

  const cycleDemo = () => {
    currentIndex = (currentIndex + 1) % demoItems.length;
    const currentItem = demoItems[currentIndex];

    demoValue.classList.add('is-fading');
    setTimeout(() => {
      demoValue.textContent = currentItem.value;
      demoNote.textContent = currentItem.note;
      demoValue.classList.remove('is-fading');
    }, 220);
  };

  setInterval(cycleDemo, 3200);
}