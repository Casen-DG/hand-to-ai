# 交给 AI (hand-to-ai)

A small Chrome / Edge extension (Manifest V3, no dependencies, no build step) that lets **your own** AI assistant operate **one browser tab you choose**. It is the browser side of a self-hosted gateway; it does nothing without one. The gateway decides everything that matters (allowed site, passwords and card fields never exposed, confirmation before submit / buy / send / delete, step and time limits); the extension only carries out commands for tabs you handed over.

- Only a tab you clicked **交给 AI** on can be controlled. It is marked with a red **AI** badge and a red banner in the page, and you can take it back any time (popup, or from the gateway).
- The extension asks the browser for access to **that tab's site only** when you hand it over, and gives it back when you take the tab back. The manifest has no standing host permissions.
- It never types into password or card fields, and screenshots only the visible tab.
- No gateway address is built in; you enter yours the first time. It must be `https://` (or `http://localhost` for local testing).

## Install (Chrome or Edge, macOS or Windows)
1. Get the code: `git clone https://github.com/Casen-DG/hand-to-ai.git` (Windows: Git for Windows, or download the ZIP from GitHub and unzip).
2. Open `chrome://extensions` (Edge: `edge://extensions`), turn **Developer mode** on, click **Load unpacked** (加载已解压的扩展程序), and select the cloned folder (the one containing `manifest.json`). Pin the extension if you like.

## Pair with your gateway
1. Click the extension icon, enter your gateway address (for the ai-system gateway: run `ai gateway url` on the machine that hosts it), click **连接**. The computer must be able to reach that address (for example both on the same Tailscale network).
2. The popup shows a 6-digit code. On the gateway machine run `ai gateway approve <code>`. The popup switches to the hand-over screen by itself.
3. Open a page, click the icon, click **交给 AI**, and allow access to that site when the browser asks. Then drive it from your assistant (for ai-system: `/web tab <task>`). **收回** takes the tab back; **断开与网关的连接** unpairs this browser.

## Update
The popup tells you when the gateway knows a newer version: 「有新版本，请 git pull 后重新加载」.
1. `git pull` in the cloned folder (ZIP install: download the ZIP again and replace the folder contents).
2. `chrome://extensions` → click the reload arrow on the extension card.

You stay paired across updates. To remove: `chrome://extensions` → Remove, then revoke the device on the gateway (`ai gateway revoke <id>`).

## Notes
- Manifest V3 cannot block a navigation before it happens. If a handed-over tab ends up on another site, the gateway notices on its next look and stops controlling it.
- Chrome puts extension service workers to sleep; the extension wakes about once a minute, so the first command after a long idle can take up to a minute.
- Files: `manifest.json`, `background.js` (pairing, command loop), `popup.html/js`, `page.js` (page reader that masks password / card fields). This repository is a read-only mirror of the `web/extension` directory of the author's private ai-system repository; it is synced automatically on every change there.

## License
MIT, see [LICENSE](LICENSE).
