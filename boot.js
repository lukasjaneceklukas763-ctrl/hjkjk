(() => {
  "use strict";

  const SWF_FILE = "Madness Project Nexus Classic TRUE ONLINE COOP ADMIN SPELLS.swf?v=20260622-admin-spells-v1";
  window.RufflePlayer = window.RufflePlayer || {};
  window.RufflePlayer.config = {
    autoplay: "on",
    unmuteOverlay: "visible",
    splashScreen: false,
    preloader: true,
    menu: false,
    contextMenu: "off",
    allowScriptAccess: true,
    allowNetworking: "all",
    scale: "showAll",
    forceScale: true,
    quality: "high",
    backgroundColor: "#000000",
    compatibilityRules: true,
    upgradeToHttps: true,
    logLevel: "error",
  };

  function showFatal(error) {
    const message = `CHYBA SPUŠTĚNÍ HRY: ${error?.message || error || "neznámá chyba"}`;
    console.error(error);
    if (typeof window.madnessShowDialog === "function") {
      window.madnessShowDialog(message, "error", { transient: false });
      return;
    }
    const target = document.getElementById("siteDialogMessage");
    const root = document.getElementById("siteDialog");
    if (target && root) {
      target.textContent = message;
      root.hidden = false;
    }
  }

  async function installNetworkShim() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    try {
      await navigator.serviceWorker.register("./sw.js?v=20260622-admin-spells-v1", { scope: "./" });
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          const timer = window.setTimeout(resolve, 1800);
          navigator.serviceWorker.addEventListener("controllerchange", () => {
            window.clearTimeout(timer);
            resolve();
          }, { once: true });
        });
      }
    } catch (error) {
      console.warn("Síťový filtr se nepodařilo aktivovat:", error);
    }
  }

  function installAudioUnlock(api) {
    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      try { api.resume(); } catch (_) {}
      try { api.volume = 1; } catch (_) {}
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
  }

  window.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("game");
    if (!container) {
      showFatal(new Error("Chybí herní kontejner."));
      return;
    }

    try {
      await installNetworkShim();
      const ruffle = window.RufflePlayer?.newest?.();
      if (!ruffle) throw new Error("Ruffle se nenačetl. Zkontroluj internetové připojení.");
      const player = ruffle.createPlayer();
      player.id = "rufflePlayer";
      player.style.width = "100%";
      player.style.height = "100%";
      container.replaceChildren(player);
      const api = player.ruffle();
      installAudioUnlock(api);
      await api.load({
        url: SWF_FILE,
        base: "./",
        allowScriptAccess: true,
        allowNetworking: "all",
        autoplay: "on",
        unmuteOverlay: "visible",
        splashScreen: false,
        preloader: true,
        scale: "showAll",
        forceScale: true,
        quality: "high",
        backgroundColor: "#000000",
        compatibilityRules: true,
        upgradeToHttps: true,
        logLevel: "error",
          });
      window.__madnessRufflePlayer = player;
      window.dispatchEvent(new CustomEvent("madness-ruffle-ready"));
    } catch (error) {
      showFatal(error);
    }
  }, { once: true });
})();
