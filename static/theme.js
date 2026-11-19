// BTC Observer — shared theme init + toggle (used by guide.html).
// CSP-safe: external file, no inline scripts. Same localStorage key as app.js.
(function () {
  try {
    var saved = localStorage.getItem("btc-observer-theme");
    if (saved !== "light" && saved !== "dark") saved = "dark";
    document.documentElement.setAttribute("data-theme", saved);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", saved === "light" ? "#f4f6fb" : "#050507");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
  var btn = document.getElementById("themeToggle");
  if (btn) {
    btn.addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", cur);
      try { localStorage.setItem("btc-observer-theme", cur); } catch (e) { /* private mode */ }
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", cur === "light" ? "#f4f6fb" : "#050507");
      var icon = btn.querySelector(".theme-toggle-icon");
      var label = btn.querySelector(".theme-toggle-label");
      if (icon) icon.textContent = cur === "light" ? "☾" : "☀";
      if (label) label.textContent = cur === "light" ? "DARK" : "LIGHT";
    });
  }
})();
