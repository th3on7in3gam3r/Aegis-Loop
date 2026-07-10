(function () {
  var KEY = 'aegis-cookie-consent';
  if (localStorage.getItem(KEY)) return;

  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/assets/cookie-consent.css';
  document.head.appendChild(link);

  var bar = document.createElement('div');
  bar.className = 'cookie-banner';
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-label', 'Cookie preferences');
  bar.innerHTML =
    '<div class="cookie-banner-inner">' +
    '<p>We use essential cookies for sign-in sessions only — no tracking. ' +
    'See our <a href="/legal/cookies">Cookie Policy</a> for details.</p>' +
    '<div class="cookie-banner-actions">' +
    '<button type="button" class="cookie-btn-accept" data-choice="essential">Got it</button>' +
    '</div></div>';

  bar.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-choice]');
    if (!btn) return;
    localStorage.setItem(KEY, btn.getAttribute('data-choice'));
    bar.remove();
  });

  document.body.appendChild(bar);
})();
