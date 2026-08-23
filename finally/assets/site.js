/* Finally VR public site — tiny shared behaviors. No tracking, no network. */
(function () {
  "use strict";
  // 1. Rail: highlight the section in view.
  var links = Array.prototype.slice.call(document.querySelectorAll("nav.rail a[href^='#']"));
  var sections = links.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); }).filter(Boolean);
  if ("IntersectionObserver" in window && sections.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id); });
      });
    }, { rootMargin: "-20% 0px -65% 0px", threshold: 0.01 });
    sections.forEach(function (s) { io.observe(s); });
  }
  // 2. Mobile store dock: appear once the first store button has scrolled away.
  var dock = document.querySelector(".get-dock");
  var first = document.querySelector(".stage .store-cta, header.hero .store-cta, header.hero .get, .topbar .get");
  if (dock) {
    if ("IntersectionObserver" in window && first) {
      var seen = false;
      var io2 = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) seen = true;
          dock.classList.toggle("show", seen && !e.isIntersecting && e.boundingClientRect.top < 0);
        });
      }, { threshold: 0 });
      io2.observe(first);
    } else {
      dock.classList.add("show");
    }
  }
})();
