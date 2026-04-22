import { BrowserWindow, screen, ipcMain } from 'electron'

export interface CaptureRegion {
  displayId: number
  x: number
  y: number
  w: number
  h: number
}

export function selectRegion(): Promise<CaptureRegion | null> {
  return new Promise((resolve) => {
    const displays = screen.getAllDisplays()
    const channelId = `region-selected-${Date.now()}`
    const overlays: BrowserWindow[] = []

    const cursorDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    console.log(`[Region] ${displays.length} displays, cursorDisplaySf=${cursorDisplay.scaleFactor}`)

    let resolved = false
    function finish(region: CaptureRegion | null): void {
      if (resolved) return
      resolved = true
      ipcMain.removeAllListeners(channelId)
      for (const w of overlays) {
        if (!w.isDestroyed()) w.close()
      }
      resolve(region)
    }

    ipcMain.on(channelId, (_, region: CaptureRegion | null) => {
      finish(region)
    })

    for (const display of displays) {
      const { x, y, width, height } = display.bounds
      const sf = display.scaleFactor || 1

      const overlay = new BrowserWindow({
        x,
        y,
        width,
        height,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        fullscreenable: false,
        hasShadow: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false
        }
      })

      overlay.setVisibleOnAllWorkspaces(true)
      overlay.on('closed', () => finish(null))
      overlays.push(overlay)

      const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; }
  html, body { width: 100vw; height: 100vh; overflow: hidden; cursor: crosshair; user-select: none; }
  body { background: rgba(0,0,0,0.25); }
  #info {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
    color: #fff; font: 600 22px -apple-system, sans-serif;
    text-shadow: 0 2px 8px rgba(0,0,0,0.6);
    pointer-events: none; transition: opacity 0.2s;
    text-align: center; line-height: 1.6;
  }
  #rect {
    position: fixed; border: 2px solid #1677ff; background: rgba(22,119,255,0.12);
    pointer-events: none; display: none;
  }
  #size-label {
    position: fixed; color: #fff; font: 12px -apple-system, monospace; background: rgba(0,0,0,0.7);
    padding: 3px 8px; border-radius: 4px; pointer-events: none; display: none;
  }
</style>
</head>
<body>
  <div id="info">拖动鼠标框选微信聊天区域<br><span style="font-size:14px;font-weight:400;opacity:0.8">按 ESC 取消</span></div>
  <div id="rect"></div>
  <div id="size-label"></div>
<script>
  const { ipcRenderer } = require('electron');
  const sf = ${sf};
  const displayId = ${display.id};
  const channel = '${channelId}';
  const rect = document.getElementById('rect');
  const info = document.getElementById('info');
  const sizeLabel = document.getElementById('size-label');
  let startX = 0, startY = 0, dragging = false;

  document.addEventListener('mousedown', (e) => {
    startX = e.clientX; startY = e.clientY;
    dragging = true;
    info.style.opacity = '0';
    rect.style.display = 'block';
    sizeLabel.style.display = 'block';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    rect.style.left = x + 'px'; rect.style.top = y + 'px';
    rect.style.width = w + 'px'; rect.style.height = h + 'px';
    sizeLabel.style.left = (x + w + 8) + 'px';
    sizeLabel.style.top = y + 'px';
    sizeLabel.textContent = Math.round(w * sf) + ' × ' + Math.round(h * sf);
  });

  document.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    if (w > 20 && h > 20) {
      ipcRenderer.send(channel, {
        displayId,
        x: Math.round(x * sf),
        y: Math.round(y * sf),
        w: Math.round(w * sf),
        h: Math.round(h * sf)
      });
    } else {
      rect.style.display = 'none';
      sizeLabel.style.display = 'none';
      info.style.opacity = '1';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') ipcRenderer.send(channel, null);
  });
</script>
</body>
</html>`

      overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      overlay.show()
    }

    // Focus the overlay on the cursor's display
    const cursorOverlay = overlays.find((_, i) => displays[i].id === cursorDisplay.id)
    if (cursorOverlay) cursorOverlay.focus()
  })
}
