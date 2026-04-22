import { execFile } from 'child_process'
import { promisify } from 'util'
import { unlink } from 'fs/promises'
import type { OcrResult } from '../types'

const execFileAsync = promisify(execFile)

// Use macOS built-in `osascript -l AppleScript` calling Objective-C bridge
// to access Vision framework. No Swift dependency.
function buildOcrAppleScript(imagePath: string): string {
  return `
use framework "Vision"
use framework "AppKit"
use scripting additions

set imagePath to "${imagePath.replace(/"/g, '\\"')}"
set theImage to current application's NSImage's alloc()'s initWithContentsOfFile:imagePath

if theImage is missing value then
  return "[]"
end if

set tiffData to theImage's TIFFRepresentation()
set bitmapRep to current application's NSBitmapImageRep's imageRepWithData:tiffData
set ciImage to current application's CIImage's imageWithBitmapImageRep:bitmapRep

set imgWidth to theImage's |size|()'s width
set imgHeight to theImage's |size|()'s height

set theRequest to current application's VNRecognizeTextRequest's alloc()'s init()
theRequest's setRecognitionLanguages:{"zh-Hans", "zh-Hant", "en"}
theRequest's setRecognitionLevel:(current application's VNRequestTextRecognitionLevelAccurate)
theRequest's setUsesLanguageCorrection:true

set theHandler to current application's VNImageRequestHandler's alloc()'s initWithCIImage:ciImage options:(current application's NSDictionary's dictionary())
theHandler's performRequests:{theRequest} |error|:(missing value)

set theResults to theRequest's results()
set resultCount to theResults's |count|()

if resultCount = 0 then
  return "[]"
end if

set jsonParts to {}
repeat with i from 0 to (resultCount - 1)
  set observation to (theResults's objectAtIndex:i)
  set topCandidate to ((observation's topCandidates:1)'s objectAtIndex:0)
  set recognizedText to (topCandidate's |string|()) as text

  set bb to observation's boundingBox()
  set bx to (current application's NSMidX(bb)) as real
  set by to (1 - (current application's NSMidY(bb))) as real
  set bw to (current application's NSWidth(bb)) as real
  set bh to (current application's NSHeight(bb)) as real
  set conf to (observation's confidence()) as real

  -- Escape text for JSON
  set cleanText to my escapeJSON(recognizedText)

  set end of jsonParts to "{" & quoted form of "text" & ":" & quoted form of cleanText & "," & quoted form of "x" & ":" & (bx as text) & "," & quoted form of "y" & ":" & (by as text) & "," & quoted form of "confidence" & ":" & (conf as text) & "}"
end repeat

-- Manually build JSON since AppleScript has limited string handling
set jsonStr to "[" & my joinList(jsonParts, ",") & "]"
return jsonStr

on joinList(theList, delimiter)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to delimiter
  set result to theList as text
  set AppleScript's text item delimiters to oldDelims
  return result
end joinList

on escapeJSON(theText)
  set theText to my replaceText(theText, "\\\\", "\\\\\\\\")
  set theText to my replaceText(theText, "\\"", "\\\\\\"")
  set theText to my replaceText(theText, return, "\\\\n")
  set theText to my replaceText(theText, linefeed, "\\\\n")
  set theText to my replaceText(theText, tab, "\\\\t")
  return theText
end escapeJSON

on replaceText(theText, searchStr, replaceStr)
  set oldDelims to AppleScript's text item delimiters
  set AppleScript's text item delimiters to searchStr
  set parts to text items of theText
  set AppleScript's text item delimiters to replaceStr
  set result to parts as text
  set AppleScript's text item delimiters to oldDelims
  return result
end replaceText
`
}

export async function ocrImage(imagePath: string): Promise<OcrResult[]> {
  try {
    const script = buildOcrAppleScript(imagePath)
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024
    })

    const raw = stdout.trim()
    if (!raw || raw === '[]') return []

    // Parse the AppleScript output - it uses single quotes for keys
    // Convert to proper JSON
    const jsonStr = raw
      .replace(/'text':/g, '"text":')
      .replace(/'x':/g, '"x":')
      .replace(/'y':/g, '"y":')
      .replace(/'confidence':/g, '"confidence":')
      .replace(/'([^']*)'/g, '"$1"')

    const results: OcrResult[] = JSON.parse(jsonStr)
    return results.sort((a, b) => a.y - b.y)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[OCR] Failed:', msg.substring(0, 200))
    return []
  }
}

export async function ocrImageAndCleanup(imagePath: string): Promise<OcrResult[]> {
  try {
    return await ocrImage(imagePath)
  } finally {
    try {
      await unlink(imagePath)
    } catch { /* ignore */ }
  }
}

export function parseMessagesFromOcr(ocrResults: OcrResult[]): Array<{
  sender: string
  content: string
}> {
  const messages: Array<{ sender: string; content: string }> = []
  const lines = ocrResults
    .sort((a, b) => a.y - b.y)
    .map((r) => ({ text: r.text, x: r.x, y: r.y }))

  let currentSender = ''
  let currentContent = ''

  for (const line of lines) {
    const isLeftAligned = line.x < 0.4
    const isRightAligned = line.x > 0.5

    const senderMatch = line.text.match(/^(.{1,20})[：:]$/)
    if (senderMatch) {
      if (currentSender && currentContent) {
        messages.push({ sender: currentSender, content: currentContent.trim() })
      }
      currentSender = senderMatch[1]
      currentContent = ''
      continue
    }

    if (isLeftAligned && !isRightAligned) {
      if (currentContent && currentSender) {
        messages.push({ sender: currentSender, content: currentContent.trim() })
      }
      if (!currentSender) currentSender = 'unknown'
      currentContent = line.text
    } else if (isRightAligned) {
      if (currentContent && currentSender) {
        messages.push({ sender: currentSender, content: currentContent.trim() })
      }
      currentSender = 'me'
      currentContent = line.text
    } else {
      currentContent += (currentContent ? ' ' : '') + line.text
    }
  }

  if (currentSender && currentContent) {
    messages.push({ sender: currentSender, content: currentContent.trim() })
  }

  return messages
}
