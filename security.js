/* GitHub Pages cannot set frame-ancestors headers; block embedded application
 * startup as a second layer alongside the server policy used on Vercel. */
(() => {
  if (window.top === window.self) return;
  document.documentElement.dataset.embedded = 'true';
  document.addEventListener('DOMContentLoaded', () => {
    const main = document.createElement('main');
    const heading = document.createElement('h1');
    heading.textContent = 'Open this app directly';
    const text = document.createElement('p');
    text.textContent = 'For your account’s privacy, this app does not run inside another website.';
    const link = document.createElement('a');
    link.href = location.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open the app in a new tab';
    main.append(heading, text, link);
    document.body.className = '';
    document.body.replaceChildren(main);
  }, {once: true});
})();
