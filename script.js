// Footer year
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Inject PTO notice HTML
fetch("components/pto-notice/pto-notice.html")
  .then((res) => res.text())
  .then((html) => {
    const container = document.getElementById("pto-notice-container");
    if (container) container.innerHTML = html;
  })
  .catch((err) => console.error("PTO notice load failed:", err));
