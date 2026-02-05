(function () {
  const KEY = "pto_notice_dismissed_v1";
  const MAX_RETRIES = 30;
  const INTERVAL = 100;

  function wireUp() {
    const notice = document.getElementById("ptoNotice");
    const closeBtn = document.getElementById("ptoNoticeClose");
    const closeX = document.getElementById("ptoNoticeX");
    const dontShow = document.getElementById("ptoNoticeDontShow");

    if (!notice || !closeBtn) return false;
    if (localStorage.getItem(KEY) === "true") return true;

    notice.hidden = false;

    const close = () => {
      if (dontShow && dontShow.checked) {
        localStorage.setItem(KEY, "true");
      }
      notice.hidden = true;
    };

    closeBtn.addEventListener("click", close);
    if (closeX) closeX.addEventListener("click", close);

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });

    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts++;
    if (wireUp() || attempts >= MAX_RETRIES) clearInterval(timer);
  }, INTERVAL);
})();
