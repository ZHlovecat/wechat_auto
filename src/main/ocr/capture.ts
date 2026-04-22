import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { app } from 'electron'
import { existsSync, mkdirSync, statSync } from 'fs'

const execFileAsync = promisify(execFile)

function getTempDir(): string {
  const tempDir = join(app.getPath('temp'), 'wechat-auto')
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true })
  }
  return tempDir
}

export async function captureScreen(
  region?: { displayId?: number; x: number; y: number; w: number; h: number }
): Promise<string> {
  const outputPath = join(getTempDir(), `capture_${Date.now()}.png`)

  if (region) {
    const fullPath = join(getTempDir(), `full_${Date.now()}.png`)
    // Prefer capturing the exact display to avoid multi-monitor coordinate mismatch.
    // `screencapture -D <display>` accepts a numeric display id on macOS.
    const args = ['-x', '-t', 'png']
    if (typeof region.displayId === 'number') {
      args.push('-D', String(region.displayId))
    }
    args.push(fullPath)
    await execFileAsync('screencapture', args, { timeout: 10000 })

    const fullSize = statSync(fullPath).size
    console.log(`[Capture] Full screenshot: ${fullSize} bytes`)

    // Use Python (macOS built-in) to crop precisely
    const pyScript = `
import subprocess
r=subprocess.run(['sips','--getProperty','pixelWidth','--getProperty','pixelHeight','${fullPath.replace(/'/g, "\\'")}'],capture_output=True,text=True)
lines=r.stdout.strip().split('\\n')
fw=int([l for l in lines if 'pixelWidth' in l][0].split(':')[1].strip())
fh=int([l for l in lines if 'pixelHeight' in l][0].split(':')[1].strip())
x,y,w,h=${region.x},${region.y},${region.w},${region.h}
if x+w>fw: w=fw-x
if y+h>fh: h=fh-y
if w<=0 or h<=0:
    import shutil; shutil.copy('${fullPath.replace(/'/g, "\\'")}','${outputPath.replace(/'/g, "\\'")}')
else:
    # sips: first crop offset, then crop size
    subprocess.run(['sips','--cropOffset',str(y),str(x),'--cropToHeightWidth',str(h),str(w),'${fullPath.replace(/'/g, "\\'")}','--out','${outputPath.replace(/'/g, "\\'")}'],capture_output=True)
print(f'{fw}x{fh} -> crop({x},{y},{w},{h})')
`
    const { stdout } = await execFileAsync('python3', ['-c', pyScript], { timeout: 15000 })
    console.log(`[Capture] Crop: ${stdout.trim()}`)

    const cropSize = existsSync(outputPath) ? statSync(outputPath).size : 0
    console.log(`[Capture] Cropped image: ${cropSize} bytes`)

    try { await execFileAsync('rm', [fullPath]) } catch { /* */ }
  } else {
    await execFileAsync('screencapture', ['-x', '-t', 'png', outputPath], { timeout: 10000 })
  }

  return outputPath
}
