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
    '<p>We use essential cookies for sign-in sessions and optional analytics to improve the product. ' +
    'See our <a href="/legal/cookies">Cookie Policy</a> for details.</p>' +
    '<div class="cookie-banner-actions">' +
    '<button type="button" class="cookie-btn-essential" data-choice="essential">Essential only</button>' +
    '<button type="button" class="cookie-btn-accept" data-choice="all">Accept all</button>' +
    '</div></div>';

  function dismiss(choice) {
    localStorage.setItem(KEY, choice);
    bar.remove();
    window.dispatchEvent(new CustomEvent('aegis-cookie-consent', { detail: choice }));
    if (choice === 'all') {
      var script = document.createElement('script');
      script.src = '/assets/aegis-analytics.js';
      script.defer = true;
      document.head.appendChild(script);
    }
  }

  bar.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-choice]');
    if (!btn) return;
    dismiss(btn.getAttribute('data-choice'));
  });

  if (localStorage.getItem(KEY) === 'all') {
    var script = document.createElement('script');
    script.src = '/assets/aegis-analytics.js';
    script.defer = true;
    document.head.appendChild(script);
  }

  document.body.appendChild(bar);
})();
