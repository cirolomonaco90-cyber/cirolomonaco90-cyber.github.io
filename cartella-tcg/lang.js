// Lingua della pagina: scelta dell'utente, altrimenti quella del browser (italiano o inglese).
(function () {
  var saved = null;
  try { saved = localStorage.getItem("lang"); } catch (e) {}
  var lang = saved || ((navigator.language || "en").slice(0, 2) === "it" ? "it" : "en");
  function apply(l) {
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.lang = l;
    document.querySelectorAll("[data-set-lang]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-set-lang") === l ? "true" : "false");
    });
  }
  apply(lang);
  document.addEventListener("DOMContentLoaded", function () {
    apply(lang);
    document.querySelectorAll("[data-set-lang]").forEach(function (b) {
      b.addEventListener("click", function () {
        lang = b.getAttribute("data-set-lang");
        try { localStorage.setItem("lang", lang); } catch (e) {}
        apply(lang);
      });
    });
  });
})();
