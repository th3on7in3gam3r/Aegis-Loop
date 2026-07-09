(function () {
  var CONSENT_KEY = 'aegis-cookie-consent';
  var VID_KEY = 'aegis_vid';
  var SID_KEY = 'aegis_sid';
  var SCROLL_SENT = {};
  var ENDPOINT = '/api/analytics/collect';

  function consentGranted() {
    return localStorage.getItem(CONSENT_KEY) === 'all';
  }

  function visitorId() {
    var id = localStorage.getItem(VID_KEY);
    if (!id) {
      id = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(VID_KEY, id);
    }
    return id;
  }

  function sessionId() {
    var id = sessionStorage.getItem(SID_KEY);
    if (!id) {
      id = 's_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(SID_KEY, id);
    }
    return id;
  }

  function utmParams() {
    var params = new URLSearchParams(window.location.search);
    return {
      utmSource: params.get('utm_source') || undefined,
      utmMedium: params.get('utm_medium') || undefined,
      utmCampaign: params.get('utm_campaign') || undefined,
    };
  }

  function baseEvent(type) {
    var utm = utmParams();
    return {
      type: type,
      visitorId: visitorId(),
      sessionId: sessionId(),
      path: window.location.pathname || '/',
      referrer: document.referrer || undefined,
      utmSource: utm.utmSource,
      utmMedium: utm.utmMedium,
      utmCampaign: utm.utmCampaign,
    };
  }

  function send(events) {
    if (!events.length) return;
    var body = JSON.stringify({ events: events });
    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(ENDPOINT, blob);
      return;
    }
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true,
    }).catch(function () {});
  }

  function trackPageview() {
    send([baseEvent('pageview')]);
  }

  function clickLabel(el) {
    if (el.getAttribute('data-aegis-track')) return el.getAttribute('data-aegis-track');
    var text = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text) return text.slice(0, 120);
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.id) return '#' + el.id;
    return el.tagName.toLowerCase();
  }

  function trackClick(e) {
    var el = e.target.closest('a, button, [data-aegis-track], .btn, .price-card a, .nav-link');
    if (!el) return;
    var rect = document.documentElement.getBoundingClientRect();
    var x = rect.width ? ((e.clientX / window.innerWidth) * 100) : 0;
    var y = rect.height ? ((e.clientY / window.innerHeight) * 100) : 0;
    var event = baseEvent('click');
    event.element = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
    event.label = clickLabel(el);
    event.x = Math.round(x * 10) / 10;
    event.y = Math.round(y * 10) / 10;
    event.viewportW = window.innerWidth;
    event.viewportH = window.innerHeight;
    send([event]);

    if (/pricing|upgrade|team|start for free|login/i.test(event.label)) {
      send([Object.assign(baseEvent('conversion'), { conversion: 'pricing_click' })]);
    }
  }

  function scrollDepth() {
    var doc = document.documentElement;
    var scrollTop = window.scrollY || doc.scrollTop;
    var height = Math.max(doc.scrollHeight - window.innerHeight, 1);
    var depth = Math.min(100, Math.round((scrollTop / height) * 100));
    var milestones = [25, 50, 75, 100];
    for (var i = 0; i < milestones.length; i++) {
      var m = milestones[i];
      if (depth >= m && !SCROLL_SENT[m]) {
        SCROLL_SENT[m] = true;
        var event = baseEvent('scroll');
        event.scrollDepth = m;
        send([event]);
      }
    }
  }

  function trackContactConversion() {
    send([Object.assign(baseEvent('conversion'), { conversion: 'contact' })]);
  }

  function boot() {
    if (!consentGranted()) return;
    trackPageview();
    document.addEventListener('click', trackClick, true);
    window.addEventListener('scroll', scrollDepth, { passive: true });
    scrollDepth();

    var contactForm = document.getElementById('contactForm');
    if (contactForm) {
      contactForm.addEventListener('submit', trackContactConversion);
    }
  }

  window.aegisAnalytics = {
    boot: boot,
    trackConversion: function (kind) {
      if (!consentGranted()) return;
      send([Object.assign(baseEvent('conversion'), { conversion: kind })]);
    },
  };

  if (consentGranted()) boot();

  window.addEventListener('aegis-cookie-consent', function (e) {
    if (e.detail === 'all') boot();
  });
})();
