# 交给 AI (hand-to-ai)

A small Chrome / Edge extension (Manifest V3, no dependencies, no build step) that lets **your own** AI assistant operate **your own browser**. It is the browser side of a self-hosted gateway; it does nothing without one. Pairing is the one authorisation: once this browser is paired, the assistant can open, read, screenshot, scroll, click, fill in, switch tabs and visit any website without asking again. The gateway decides everything else that matters (passwords and card fields never exposed, a typed confirmation before it buys, sends outward, submits a form, deletes or pushes, step and time limits); the extension only carries out the gateway's commands.

- **Broad access, by design (0.5.0).** The manifest asks for `tabs` and access to all http(s) sites, because the assistant must be able to list your open tabs, reuse the one a site is already open in, open a new one and read it. Only install it if you run the gateway yourself and trust it with your browser; pair only browsers you want it to drive. Unpair any time (**断开与网关的连接**, or `ai gateway revoke <id>` / `/lock` on the gateway).
- It never types into password or card fields (a login uses the browser's own saved password, filled in by the browser), and screenshots bring the tab to the front first.
- The side panel's per-tab 「交给 AI」 hand-over still works (red **AI** badge and banner) for the chat's 「问当前页面」.
- No gateway address is built in; you enter yours the first time. It must be `https://` (or `http://localhost` for local testing).

## Install (Chrome or Edge, macOS or Windows)
1. Get the code: `git clone https://github.com/Casen-DG/hand-to-ai.git` (Windows: Git for Windows, or download the ZIP from GitHub and unzip).
2. Open `chrome://extensions` (Edge: `edge://extensions`), turn **Developer mode** on, click **Load unpacked** (加载已解压的扩展程序), and select the cloned folder (the one containing `manifest.json`). Pin the extension if you like.

## Pair with your gateway
1. Click the extension icon, enter your gateway address (for the ai-system gateway: run `ai gateway url` on the machine that hosts it), click **连接**. The computer must be able to reach that address (for example both on the same Tailscale network).
2. The side panel (toolbar icon, or Ctrl/⌘+Shift+Y) shows a 6-digit code. On the gateway machine run `ai gateway approve <code>`. The panel switches to the hand-over screen by itself.
3. Done: drive the browser from your assistant (for ai-system: a plain sentence such as 「看看今天 Canvas 里有什么作业」, or `/web <task>`). The side panel's **交给 AI** / **收回** is only for asking about one page. **断开与网关的连接** unpairs this browser.

## Update
The panel tells you when the gateway knows a newer version: 「有新版本，请 git pull 后重新加载」.
1. `git pull` in the cloned folder (ZIP install: download the ZIP again and replace the folder contents).
2. `chrome://extensions` → click the reload arrow on the extension card.

You stay paired across updates. To remove: `chrome://extensions` → Remove, then revoke the device on the gateway (`ai gateway revoke <id>`).

## Notes
- Chrome puts extension service workers to sleep; the extension wakes about once a minute, so the first command after a long idle can take up to a minute.
- Files: `manifest.json`, `background.js` (pairing, command loop), `sidepanel.html/js/css` (pairing, hand-over and the chat), `page.js` (page reader that masks password / card fields). This repository is a read-only mirror of the `web/extension` directory of the author's private ai-system repository; it is synced automatically on every change there.

## License
MIT, see [LICENSE](LICENSE).
