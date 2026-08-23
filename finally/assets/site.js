/* Finally VR public site — tiny shared behaviors. No tracking, no network. */
(function () {
  "use strict";
  var STORE = "https://www.meta.com/experiences/finally-vr-video-player/1150511758154268/";
  var phone = window.matchMedia ? window.matchMedia("(max-width: 780px)") : null;

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

  // 2. Phone menu: the topbar nav pills fold into a panel behind one 44px button.
  var topbar = document.querySelector(".topbar");
  var siteNav = topbar && topbar.querySelector("nav");
  if (topbar && siteNav) {
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "menu-btn";
    btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "site-menu");
    btn.innerHTML = '<span class="menu-ico" aria-hidden="true"></span><span class="sr-only">Menu</span>';

    var panel = document.createElement("div");
    panel.id = "site-menu"; panel.className = "menu-panel"; panel.setAttribute("aria-label", "Menu");
    var html = '<a class="store-cta loud" href="' + STORE + '">Get it free on Meta Quest</a>';
    html += '<p class="menu-title">Finally</p><div class="menu-list two">';
    Array.prototype.forEach.call(siteNav.querySelectorAll("a"), function (a) {
      html += '<a href="' + a.getAttribute("href") + '"' + (a.hasAttribute("aria-current") ? ' aria-current="page"' : "") + ">" + a.textContent + "</a>";
    });
    html += "</div>";
    var rail = document.querySelector("nav.rail");
    var railLinks = rail ? rail.querySelectorAll("a") : [];
    if (railLinks.length) {
      var title = rail.querySelector(".rail-title");
      html += '<p class="menu-title">' + (title ? title.textContent : "This page") + '</p><div class="menu-list">';
      Array.prototype.forEach.call(railLinks, function (a) { html += '<a href="' + a.getAttribute("href") + '">' + a.textContent + "</a>"; });
      html += "</div>";
    }
    panel.innerHTML = '<div class="menu-in">' + html + "</div>";

    var open = false;
    function setMenu(on) {
      open = !!on;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      panel.classList.toggle("open", open);
      document.documentElement.classList.toggle("menu-open", open);
    }
    btn.addEventListener("click", function () { setMenu(!open); });
    panel.addEventListener("click", function (e) { if (e.target.closest("a")) setMenu(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && open) { setMenu(false); btn.focus(); } });
    if (phone) {
      var onChange = function (e) { if (!e.matches) setMenu(false); };
      if (phone.addEventListener) phone.addEventListener("change", onChange); else phone.addListener(onChange);
    }
    topbar.appendChild(btn);
    topbar.insertAdjacentElement("afterend", panel);
    topbar.classList.add("has-menu");
  }

  // 3. Mobile store dock: appear once the first visible store button has scrolled away.
  var dock = document.querySelector(".get-dock");
  var candidates = Array.prototype.slice.call(document.querySelectorAll(".stage .store-cta, header.hero .store-cta, header.hero .get, .topbar .get"));
  var first = null;
  for (var i = 0; i < candidates.length; i++) { if (candidates[i].offsetParent !== null) { first = candidates[i]; break; } }
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
