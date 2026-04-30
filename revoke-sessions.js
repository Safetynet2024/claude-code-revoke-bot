/**
 * Claude Code Session Revoke Bot
 *
 * Bulk-revokes all active Claude Code authorization tokens on
 * https://claude.ai/settings/claude-code
 *
 * HOW TO USE:
 *   1. Open https://claude.ai/settings/claude-code
 *   2. Open DevTools console (Cmd+Option+I on Mac, F12 on Windows/Linux)
 *   3. Paste this entire file into the console and press Enter
 *   4. A floating overlay appears in the top-right with live progress and Stop/Pause buttons
 *
 * WHY THIS IS NEEDED:
 *   - The settings page uses virtual scrolling and renders ~628 buttons even
 *     when more sessions exist; the buttons are positioned at x=1656 (off-screen)
 *     so coordinate-based mouse events do not reliably trigger them.
 *   - After a successful revoke, the website does NOT remove the row from the
 *     visible list until you reload the page. A naive "click the first revoke
 *     button" loop will therefore re-click already-revoked sessions.
 *
 * THE FIX:
 *   - Click via React's internal onClick handler (props[__reactProps...].onClick)
 *     instead of element.click() - this works reliably for off-screen
 *     virtual-scrolled elements.
 *   - After confirming each revoke, REMOVE the corresponding <tr> from the DOM
 *     so the next iteration's "first button" points to a different (still-active)
 *     session.
 */

(async function revokeBot() {
    // ===== OVERLAY UI =====
   const overlay = document.createElement('div');
    overlay.id = 'revoke-status-overlay';
    overlay.style.cssText =
          'position:fixed;top:10px;right:10px;z-index:99999;' +
          'background:rgba(0,0,0,0.93);color:#00ff88;font-family:monospace;' +
          'font-size:13px;padding:12px 16px;border-radius:8px;' +
          'border:1px solid #00ff88;min-width:305px;max-width:385px;' +
          'box-shadow:0 4px 20px rgba(0,255,136,0.3);';
    overlay.innerHTML = `
        <div style="font-weight:bold;font-size:14px;margin-bottom:6px;color:#00ff88;">
              🔄 Revoke Sessions Bot
                  </div>
                      <div id="ro-status">Starting...</div>
                          <div id="ro-count" style="margin-top:5px;font-size:22px;font-weight:bold;color:#00ff88;">
                                Revoked: 0
                                    </div>
                                        <div id="ro-remaining" style="margin-top:2px;color:#ffaa00;font-size:12px;"></div>
                                            <div id="ro-rate" style="margin-top:2px;color:#88aaff;font-size:11px;"></div>
                                                <div id="ro-log" style="margin-top:8px;max-height:200px;overflow-y:auto;font-size:11px;color:#aaffcc;border-top:1px solid #333;padding-top:5px;line-height:1.4;"></div>
                                                    <div style="margin-top:8px;display:flex;gap:8px;">
                                                          <button id="ro-stop-btn" style="background:#ff4444;color:white;border:none;padding:5px 14px;border-radius:4px;cursor:pointer;font-size:12px;">⏹ Stop</button>
                                                                <button id="ro-pause-btn" style="background:#ffaa00;color:black;border:none;padding:5px 14px;border-radius:4px;cursor:pointer;font-size:12px;">⏸ Pause</button>
                                                                    </div>`;
    document.body.appendChild(overlay);

   const state = {
         running: true,
         paused: false,
         revoked: 0,
         errors: 0,
         startTime: Date.now(),
   };
    window._revokeState = state;

   document.getElementById('ro-stop-btn').onclick = () => {
         state.running = false;
   };
    document.getElementById('ro-pause-btn').onclick = () => {
          state.paused = !state.paused;
          document.getElementById('ro-pause-btn').textContent = state.paused ? '▶ Resume' : '⏸ Pause';
    };

   const $ = (id) => document.getElementById(id);
    const ui = {
          status: (s) => { try { $('ro-status').textContent = s; } catch (e) {} },
          count: (n) => { try { $('ro-count').textContent = 'Revoked: ' + n; } catch (e) {} },
          remain: (s) => { try { $('ro-remaining').textContent = s; } catch (e) {} },
          rate: (s) => { try { $('ro-rate').textContent = s; } catch (e) {} },
          log: (msg, color) => {
                  try {
                            const log = $('ro-log');
                            if (!log) return;
                            const d = document.createElement('div');
                            const ts = new Date().toLocaleTimeString('en', { hour12: false });
                            d.textContent = ts + ' ' + msg;
                            if (color) d.style.color = color;
                            log.appendChild(d);
                            log.scrollTop = log.scrollHeight;
                            while (log.children.length > 100) log.removeChild(log.firstChild);
                  } catch (e) {}
          },
    };

   // ===== HELPERS =====
   const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

   const waitFor = (fn, maxMs, intMs = 80) =>
         new Promise((resolve) => {
                 const t0 = Date.now();
                 const check = () => {
                           try {
                                       const v = fn();
                                       if (v) { resolve(v); return; }
                           } catch (e) {}
                           if (Date.now() - t0 >= maxMs) { resolve(null); return; }
                           setTimeout(check, intMs);
                 };
                 check();
         });

   const isDialogOpen = () => {
         const d = document.querySelector('[role="dialog"]');
         return d && d.getAttribute('data-state') === 'open' ? d : null;
   };

   const isDialogClosed = () => {
         const d = document.querySelector('[role="dialog"]');
         return !d || d.getAttribute('data-state') !== 'open';
   };

   // KEY TRICK: call React's onClick directly. element.click() is unreliable
   // for buttons rendered off-screen by virtual scrolling.
   const reactClick = (el) => {
         if (!el) return false;
         const key = Object.keys(el).find((k) => k.startsWith('__reactProps'));
         if (key && el[key] && el[key].onClick) {
                 el[key].onClick({
                           preventDefault: () => {},
                           stopPropagation: () => {},
                           target: el,
                           currentTarget: el,
                 });
                 return true;
         }
         el.click();
         return false;
   };

   const findConfirmBtn = () => {
         for (const b of document.querySelectorAll('button')) {
                 if (b.textContent.trim() === 'Revoke Access') return b;
         }
         return null;
   };

   const findRowOfBtn = (btn) => {
         let el = btn;
         for (let j = 0; j < 8; j++) {
                 el = el && el.parentElement;
                 if (!el) return null;
                 if (el.tagName === 'TR') return el;
         }
         return null;
   };

   // ===== MAIN LOOP =====
   ui.log('🚀 Bot started!', '#00ff88');
    let consecFails = 0;

   while (state.running) {
         while (state.paused && state.running) await sleep(200);
         if (!state.running) break;

      // Close any stale dialog
      if (isDialogOpen()) {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              await sleep(250);
      }

      const allBtns = document.querySelectorAll('[aria-label="Revoke access"]');
         if (allBtns.length === 0) {
                 ui.log('✅ All sessions revoked!', '#00ff88');
                 ui.status('✅ Complete!');
                 ui.remain('Done!');
                 break;
         }

      // Update display
      const elapsed = (Date.now() - state.startTime) / 1000;
         if (elapsed > 3) {
                 const rpm = ((state.revoked / elapsed) * 60).toFixed(1);
                 const eta = state.revoked > 0
                   ? Math.round((allBtns.length / (state.revoked / elapsed)) / 60)
                           : '?';
                 ui.rate(`${rpm}/min | ETA: ~${eta}min | err: ${state.errors}`);
         }
         ui.remain(`~${allBtns.length} remaining`);
         ui.status(`▶ Session #${state.revoked + 1}`);

      // Always work on btn[0] (since revoked rows are removed from DOM)
      const btn = allBtns[0];
         const targetRow = findRowOfBtn(btn);

      if (!targetRow) {
              ui.log('⚠️ Could not find row for button', '#ffaa00');
              consecFails++;
              if (consecFails > 5) break;
              await sleep(200);
              continue;
      }

      // Click the revoke button
      reactClick(btn);

      // Wait for confirmation dialog
      let dialog = await waitFor(isDialogOpen, 2500, 60);
         if (!dialog) {
                 reactClick(btn); // retry once
           dialog = await waitFor(isDialogOpen, 2000, 60);
         }

      if (!dialog) {
              consecFails++;
              state.errors++;
              ui.log(`⚠️ No dialog (fail #${consecFails})`, '#ffaa00');
              if (consecFails > 10) {
                        ui.log('Too many failures, stopping.', '#ff4444');
                        break;
              }
              await sleep(300);
              continue;
      }

      consecFails = 0;

      // Find and click the "Revoke Access" confirm button
      const confirmBtn = findConfirmBtn();
         if (!confirmBtn) {
                 ui.log('❌ No confirm button', '#ff4444');
                 document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                 await sleep(300);
                 state.errors++;
                 continue;
         }

      reactClick(confirmBtn);
         state.revoked++;
         ui.count(state.revoked);

      // Wait briefly for the click to register, then remove the row from the DOM.
      // The website doesn't update its UI after a successful revoke, so we have
      // to remove the row ourselves to advance to the next session.
      await sleep(150);
         if (targetRow && targetRow.parentNode) {
                 targetRow.remove();
         }

      ui.log(`✅ #${state.revoked} revoked & removed`, '#00ff88');

      // Wait for the dialog to close
      await waitFor(isDialogClosed, 2000, 60);
         await sleep(50);
   }

   const ts = ((Date.now() - state.startTime) / 1000).toFixed(0);
    ui.status(state.running ? '✅ Done!' : '🛑 Stopped');
    ui.log(`DONE: ${state.revoked} revoked in ${ts}s (${state.errors} errors)`);
    state.running = false;
})();
