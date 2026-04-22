import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export async function runAppleScript(script: string, timeoutMs = 15000): Promise<string> {
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: timeoutMs
    })
    return stdout.trim()
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`AppleScript failed: ${msg}`)
  }
}

export const Scripts = {
  activate: `
    tell application "WeChat"
      activate
    end tell
    delay 0.5
    return "ok"
  `,

  navigateToChat: (chatName: string) => `
    tell application "WeChat"
      activate
    end tell
    delay 0.3
    tell application "System Events"
      tell process "WeChat"
        keystroke "f" using command down
        delay 0.5
        keystroke "a" using command down
        delay 0.1
        keystroke "${escapeAS(chatName)}"
        delay 1
        keystroke return
        delay 0.5
      end tell
    end tell
    return "ok"
  `,

  /**
   * 模拟真人：逐字符粘贴（兼容中文/emoji），字符间随机延时；结束后再按回车发送。
   * 相比一次性粘贴全文，视觉上会在输入框里"一个字一个字"出现。
   */
  sendMessage: (text: string) => {
    const chars = Array.from(text)
    const listLiteral = chars
      .map((c) => (c === '\n' ? '"\\n"' : `"${escapeAS(c)}"`))
      .join(', ')
    return `
    tell application "WeChat"
      activate
    end tell
    delay 0.35
    set charList to {${listLiteral}}
    tell application "System Events"
      tell process "WeChat"
        set frontmost to true
        delay 0.15
        repeat with c in charList
          set ch to c as string
          if ch is "\\n" then
            keystroke return using shift down
            delay ((random number from 8 to 16) / 100)
          else
            set the clipboard to ch
            delay 0.015
            keystroke "v" using command down
            delay ((random number from 6 to 20) / 100)
          end if
        end repeat
        delay 0.35
        keystroke return
        delay 0.3
      end tell
    end tell
    return "ok"
    `
  },

  sendImageFromClipboard: () => `
    tell application "System Events"
      tell process "WeChat"
        keystroke "v" using command down
        delay 0.8
        keystroke return
        delay 0.5
      end tell
    end tell
    return "ok"
  `,

  copyImageToClipboard: (imagePath: string) => {
    const ext = imagePath.toLowerCase()
    let imgClass = '«class PNGf»'
    if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) {
      imgClass = 'JPEG picture'
    } else if (ext.endsWith('.gif')) {
      imgClass = 'GIF picture'
    }
    return `set the clipboard to (read (POSIX file "${escapeAS(imagePath)}") as ${imgClass})`
  },

  /**
   * 尝试点击聊天窗口工具栏中的「收藏」按钮，在弹出列表中按方向键+回车逐条发送到当前会话。
   * 依赖：系统设置 → 隐私与安全性 → 辅助功能 中允许「微信」与「osascript」/「Electron」。
   * 不同微信版本 UI 可能略有差异，若失败请查看应用内错误提示。
   */
  favoritesBulkSend: (maxItems: number) => {
    const n = Math.min(20, Math.max(1, Math.floor(maxItems)))
    // 新版微信：点击「收藏」→ 弹出「发送收藏给 xxx」对话框 →
    //   侧栏点「位置」→ 勾选前 N 个单选圆圈 → 点「发送」按钮
    return `
    on favHit(nm, ds, tt, hp, vl)
      if nm is missing value then set nm to ""
      if ds is missing value then set ds to ""
      if tt is missing value then set tt to ""
      if hp is missing value then set hp to ""
      if vl is missing value then set vl to ""
      try
        set nm to nm as string
      end try
      try
        set ds to ds as string
      end try
      try
        set tt to tt as string
      end try
      try
        set hp to hp as string
      end try
      try
        set vl to vl as string
      end try
      set s to nm & " " & ds & " " & tt & " " & hp & " " & vl
      return s contains "收藏" or s contains "Favorite" or s contains "favorite" or s contains "Favorites" or s contains "favorites"
    end favHit

    global wxProc
    set wxProc to "WeChat"
    tell application "WeChat"
      activate
    end tell
    delay 0.65
    tell application "System Events"
      if not (exists process "WeChat") then
        if exists process "微信" then set wxProc to "微信"
      end if
      if not (exists process wxProc) then
        return "ERR_NO_WECHAT"
      end if
      tell process wxProc
        set frontmost to true
        delay 0.5
        set clicked to false
        try
          repeat with w in windows
            try
              repeat with sg in (every splitter group of w)
                try
                  repeat with b in (every button of sg)
                    try
                      set nm to ""
                      try
                        set nm to name of b as string
                      end try
                      set ds to ""
                      try
                        set ds to description of b as string
                      end try
                      set tt to ""
                      try
                        set tt to title of b as string
                      end try
                      set hp to ""
                      try
                        set hp to help of b as string
                      end try
                      set vl to ""
                      try
                        set vl to value of b as string
                      end try
                      if favHit(nm, ds, tt, hp, vl) then
                        click b
                        set clicked to true
                        exit repeat
                      end if
                    end try
                  end repeat
                end try
                if clicked then exit repeat
              end repeat
              if not clicked then
                repeat with sa in (every scroll area of w)
                  try
                    repeat with g in (every group of sa)
                      try
                        repeat with b in (every button of g)
                          try
                            set nm to ""
                            try
                              set nm to name of b as string
                            end try
                            set ds to ""
                            try
                              set ds to description of b as string
                            end try
                            set tt to ""
                            try
                              set tt to title of b as string
                            end try
                            set hp to ""
                            try
                              set hp to help of b as string
                            end try
                            set vl to ""
                            try
                              set vl to value of b as string
                            end try
                            if favHit(nm, ds, tt, hp, vl) then
                              click b
                              set clicked to true
                              exit repeat
                            end if
                          end try
                        end repeat
                      end try
                      if clicked then exit repeat
                    end repeat
                  end try
                  if clicked then exit repeat
                end repeat
              end if
              repeat with g1 in (every group of w)
                try
                  repeat with b in (every button of g1)
                    try
                      set nm to ""
                      try
                        set nm to name of b as string
                      end try
                      set ds to ""
                      try
                        set ds to description of b as string
                      end try
                      set tt to ""
                      try
                        set tt to title of b as string
                      end try
                      set hp to ""
                      try
                        set hp to help of b as string
                      end try
                      set vl to ""
                      try
                        set vl to value of b as string
                      end try
                      if favHit(nm, ds, tt, hp, vl) then
                        click b
                        set clicked to true
                        exit repeat
                      end if
                    end try
                  end repeat
                  if clicked then exit repeat
                  repeat with g2 in (every group of g1)
                    try
                      repeat with b in (every button of g2)
                        try
                          set nm to ""
                          try
                            set nm to name of b as string
                          end try
                          set ds to ""
                          try
                            set ds to description of b as string
                          end try
                          set tt to ""
                          try
                            set tt to title of b as string
                          end try
                          set hp to ""
                          try
                            set hp to help of b as string
                          end try
                          set vl to ""
                          try
                            set vl to value of b as string
                          end try
                          if favHit(nm, ds, tt, hp, vl) then
                            click b
                            set clicked to true
                            exit repeat
                          end if
                        end try
                      end repeat
                    end try
                    if clicked then exit repeat
                  end repeat
                end try
                if clicked then exit repeat
              end repeat
              if not clicked then
                repeat with u in (every UI element of w)
                  try
                    set r to role of u as string
                    if r is "AXToolbar" or r contains "Toolbar" then
                      repeat with b in (every button of u)
                        try
                          set nm to ""
                          try
                            set nm to name of b as string
                          end try
                          set ds to ""
                          try
                            set ds to description of b as string
                          end try
                          set tt to ""
                          try
                            set tt to title of b as string
                          end try
                          set hp to ""
                          try
                            set hp to help of b as string
                          end try
                          set vl to ""
                          try
                            set vl to value of b as string
                          end try
                          if favHit(nm, ds, tt, hp, vl) then
                            click b
                            set clicked to true
                            exit repeat
                          end if
                        end try
                      end repeat
                    end if
                  end try
                  if clicked then exit repeat
                end repeat
              end if
              if not clicked then
                repeat with b in (every button of w)
                  try
                    set nm to ""
                    try
                      set nm to name of b as string
                    end try
                    set ds to ""
                    try
                      set ds to description of b as string
                    end try
                    set tt to ""
                    try
                      set tt to title of b as string
                    end try
                    set hp to ""
                    try
                      set hp to help of b as string
                    end try
                    set vl to ""
                    try
                      set vl to value of b as string
                    end try
                    if favHit(nm, ds, tt, hp, vl) then
                      click b
                      set clicked to true
                      exit repeat
                    end if
                  end try
                end repeat
              end if
              if not clicked then
                repeat with g1 in (every group of w)
                  try
                    repeat with rb in (every radio button of g1)
                      try
                        set nm to ""
                        try
                          set nm to name of rb as string
                        end try
                        set ds to ""
                        try
                          set ds to description of rb as string
                        end try
                        set tt to ""
                        try
                          set tt to title of rb as string
                        end try
                        set hp to ""
                        try
                          set hp to help of rb as string
                        end try
                        set vl to ""
                        try
                          set vl to value of rb as string
                        end try
                        if favHit(nm, ds, tt, hp, vl) then
                          click rb
                          set clicked to true
                          exit repeat
                        end if
                      end try
                    end repeat
                  end try
                  if clicked then exit repeat
                end repeat
              end if
              if not clicked then
                try
                  set elemList to entire contents of w
                  set idx to 0
                  repeat with elem in elemList
                    set idx to idx + 1
                    if idx > 600 then exit repeat
                    try
                      set r to role of elem as string
                      if r is in {"AXButton", "AXMenuButton", "AXPopUpButton", "AXCheckBox", "AXRadioButton"} then
                        set nm to ""
                        try
                          set nm to name of elem as string
                        end try
                        set ds to ""
                        try
                          set ds to description of elem as string
                        end try
                        set tt to ""
                        try
                          set tt to title of elem as string
                        end try
                        set hp to ""
                        try
                          set hp to help of elem as string
                        end try
                        set vl to ""
                        try
                          set vl to value of elem as string
                        end try
                        if favHit(nm, ds, tt, hp, vl) then
                          click elem
                          set clicked to true
                          exit repeat
                        end if
                      end if
                    end try
                  end repeat
                end try
              end if
            end try
            if clicked then exit repeat
          end repeat
        on error
          set clicked to false
        end try
        if not clicked then
          return "ERR_FAVORITES_BUTTON"
        end if
      end tell
    end tell
    delay 1.2
    -- Step 2：在「发送收藏给…」对话框中：先点「位置」过滤 → 勾选前 N 个 → 点「发送」
    tell application "System Events"
      tell process wxProc
        set dlgElems to {}
        try
          set dlgElems to entire contents of window 1
        end try
        if (count of dlgElems) is 0 then
          return "ERR_FAVORITES_DIALOG"
        end if

        -- 2a. 点击侧栏「位置」
        set locationClicked to false
        set idx to 0
        repeat with elem in dlgElems
          set idx to idx + 1
          if idx > 800 then exit repeat
          try
            set r to role of elem as string
            set txt to ""
            try
              set txt to name of elem as string
            end try
            if txt is "" then
              try
                set txt to value of elem as string
              end try
            end if
            if txt is "" then
              try
                set txt to description of elem as string
              end try
            end if
            if txt is "位置" and (r is "AXStaticText" or r is "AXCell" or r is "AXRow" or r is "AXButton") then
              try
                click elem
                set locationClicked to true
                exit repeat
              end try
            end if
          end try
        end repeat
        if locationClicked then
          delay 0.6
          try
            set dlgElems to entire contents of window 1
          end try
        end if

        -- 2b. 勾选前 N 个 AXCheckBox / AXRadioButton（按出现顺序）
        set checkedCount to 0
        set idx to 0
        repeat with elem in dlgElems
          set idx to idx + 1
          if idx > 1500 then exit repeat
          if checkedCount ≥ ${n} then exit repeat
          try
            set r to role of elem as string
            if r is "AXCheckBox" or r is "AXRadioButton" then
              set already to false
              try
                set v to value of elem
                if v is 1 or v is true then set already to true
              end try
              if not already then
                try
                  click elem
                  delay 0.18
                  set checkedCount to checkedCount + 1
                end try
              end if
            end if
          end try
        end repeat

        if checkedCount is 0 then
          try
            key code 53
          end try
          return "ERR_FAVORITES_NO_ITEMS"
        end if

        -- 2c. 点击「发送」按钮
        delay 0.3
        try
          set dlgElems to entire contents of window 1
        end try
        set sendClicked to false
        set idx to 0
        repeat with elem in dlgElems
          set idx to idx + 1
          if idx > 1500 then exit repeat
          try
            set r to role of elem as string
            if r is "AXButton" then
              set nm to ""
              try
                set nm to name of elem as string
              end try
              set tt to ""
              try
                set tt to title of elem as string
              end try
              set s to nm & " " & tt
              if s contains "发送" or s contains "Send" then
                try
                  click elem
                  set sendClicked to true
                  exit repeat
                end try
              end if
            end if
          end try
        end repeat
        if not sendClicked then
          try
            key code 36
          end try
        end if
        delay 0.4
      end tell
    end tell
    return "ok"
    `
  },

  /**
   * 获取「发送收藏给 xxx」对话框（sheet）的屏幕位置和大小，返回 "x,y,w,h" 或 "ERR_NO_DIALOG"。
   * 对话框通常是微信主窗口的 sheet；少数版本可能作为独立 window 出现。
   */
  favoritesGetDialogBounds: () => `
    set wxProc to "WeChat"
    tell application "System Events"
      if not (exists process "WeChat") then
        if exists process "微信" then set wxProc to "微信"
      end if
      if not (exists process wxProc) then return "ERR_NO_WECHAT"
      tell process wxProc
        try
          repeat with w in windows
            try
              if (count of sheets of w) > 0 then
                set sh to sheet 1 of w
                set p to position of sh
                set s to size of sh
                return (item 1 of p as string) & "," & (item 2 of p as string) & "," & (item 1 of s as string) & "," & (item 2 of s as string)
              end if
            end try
          end repeat
        end try
        try
          repeat with w in windows
            try
              set sr to subrole of w as string
              if sr is "AXDialog" or sr is "AXSystemDialog" then
                set p to position of w
                set s to size of w
                return (item 1 of p as string) & "," & (item 2 of p as string) & "," & (item 1 of s as string) & "," & (item 2 of s as string)
              end if
            end try
          end repeat
        end try
        return "ERR_NO_DIALOG"
      end tell
    end tell
  `,

  /**
   * 收藏对话框「搜索收藏」输入框一体化填充：
   *   AX 定位对话框 → 找到第一个 AXTextField → click 聚焦 → Cmd+A / Delete 清空 → Cmd+V 粘贴。
   * 不按回车；搜索框会即时过滤右侧列表。
   *
   * 故意走 AX 控件定位而非坐标估算：y 比例估算一旦偏上就会点到标题栏，导致 sheet 失焦，
   * 后续 Cmd+A/Delete 作用到主窗口输入框，产生一系列副作用（sheet 被收起、关键词粘到聊天框）。
   *
   * 返回：ok / ERR_NO_DIALOG / ERR_NO_SEARCH_FIELD / ERR_CLICK:... / ERR_KEYSTROKE:...
   */
  favoritesSearchFillKeyword: (keyword: string) => `
    set the clipboard to "${escapeAS(keyword)}"
    set wxProc to "WeChat"
    tell application "System Events"
      if not (exists process "WeChat") then
        if exists process "微信" then set wxProc to "微信"
      end if
      if not (exists process wxProc) then return "ERR_NO_WECHAT"
      tell process wxProc
        set dlg to missing value
        try
          repeat with w in windows
            try
              if (count of sheets of w) > 0 then
                set dlg to sheet 1 of w
                exit repeat
              end if
            end try
          end repeat
        end try
        if dlg is missing value then
          try
            repeat with w in windows
              try
                set sr to subrole of w as string
                if sr is "AXDialog" or sr is "AXSystemDialog" then
                  set dlg to w
                  exit repeat
                end if
              end try
            end repeat
          end try
        end if
        if dlg is missing value then return "ERR_NO_DIALOG"

        set tf to missing value
        set roleSummary to ""
        set summaryCount to 0
        try
          set allElems to entire contents of dlg
          repeat with elem in allElems
            try
              set r to role of elem as string
              if r is "AXTextField" or r is "AXSearchField" or r is "AXTextArea" or r is "AXComboBox" then
                set tf to elem
                exit repeat
              end if
            end try
          end repeat
          if tf is missing value then
            -- 诊断：把前 40 个元素的 role 回传，便于排查搜索框真实 role
            repeat with elem in allElems
              if summaryCount ≥ 40 then exit repeat
              try
                set r to role of elem as string
                set roleSummary to roleSummary & r & ","
                set summaryCount to summaryCount + 1
              end try
            end repeat
          end if
        end try
        if tf is missing value then return "ERR_NO_SEARCH_FIELD:" & roleSummary

        try
          click tf
          delay 0.18
        on error errMsg
          return "ERR_CLICK:" & errMsg
        end try

        try
          keystroke "a" using command down
          delay 0.12
          key code 51
          delay 0.12
          keystroke "v" using command down
          delay 0.25
        on error errMsg
          return "ERR_KEYSTROKE:" & errMsg
        end try
      end tell
    end tell
    return "ok"
  `,

  /**
   * 检查「发送收藏给 xxx」对话框内容区列表项数量，用来判断搜索结果是否为空。
   * 用左侧「全部收藏 / 位置 / 标签」静态文本的 x 右边界估算侧栏宽度，只统计 x > sidebarMaxX 的
   * AXCheckBox / AXRadioButton。返回 "items=N,src=sheet|dialog|window1" 或 "ERR_*"（含细分原因）。
   */
  favoritesDialogInspect: () => `
    set wxProc to "WeChat"
    tell application "System Events"
      if not (exists process "WeChat") then
        if exists process "微信" then set wxProc to "微信"
      end if
      if not (exists process wxProc) then return "ERR_NO_WECHAT"
      tell process wxProc
        set dlgElems to {}
        set hasDlg to false
        set srcTag to ""
        try
          repeat with w in windows
            try
              if (count of sheets of w) > 0 then
                set dlgElems to entire contents of sheet 1 of w
                set hasDlg to true
                set srcTag to "sheet"
                exit repeat
              end if
            end try
          end repeat
        end try
        if not hasDlg then
          try
            repeat with w in windows
              try
                set sr to subrole of w as string
                if sr is "AXDialog" or sr is "AXSystemDialog" then
                  set dlgElems to entire contents of w
                  set hasDlg to true
                  set srcTag to "dialog"
                  exit repeat
                end if
              end try
            end repeat
          end try
        end if
        if not hasDlg then
          try
            set dlgElems to entire contents of window 1
            set hasDlg to true
            set srcTag to "window1"
          end try
        end if
        if not hasDlg then return "ERR_NO_SHEET_OR_DIALOG"
        if (count of dlgElems) is 0 then return "ERR_EMPTY_CONTENTS"

        set sidebarMaxX to 0
        set idx to 0
        repeat with elem in dlgElems
          set idx to idx + 1
          if idx > 1500 then exit repeat
          try
            set r to role of elem as string
            set txt to ""
            try
              set txt to name of elem as string
            end try
            if txt is "" then
              try
                set txt to value of elem as string
              end try
            end if
            if r is "AXStaticText" and (txt is "全部收藏" or txt is "位置" or txt is "标签") then
              try
                set posList to position of elem
                set px to item 1 of posList
                set sz to size of elem
                set sw to item 1 of sz
                if (px + sw) > sidebarMaxX then set sidebarMaxX to (px + sw)
              end try
            end if
          end try
        end repeat
        if sidebarMaxX is 0 then set sidebarMaxX to 180

        set itemCount to 0
        set idx to 0
        repeat with elem in dlgElems
          set idx to idx + 1
          if idx > 2000 then exit repeat
          try
            set r to role of elem as string
            if r is "AXCheckBox" or r is "AXRadioButton" then
              try
                set posList to position of elem
                set px to item 1 of posList
                if px > sidebarMaxX then
                  set itemCount to itemCount + 1
                end if
              end try
            end if
          end try
        end repeat
        return "items=" & itemCount & ",src=" & srcTag
      end tell
    end tell
  `,

  /**
   * 纯 keystroke 版「搜索框填入」：调用方需保证搜索框已聚焦（通常先坐标 click）。
   * 作为 `favoritesSearchFillKeyword` AX 一体化版失败时的回退——对 Electron/WebView
   * 内嵌搜索框，AX 树看不到 AXTextField，只能走坐标点击 + keystroke。
   * 不做 Cmd+A / Delete（避免搜索框未聚焦时误伤主窗口），直接 Cmd+V 粘贴。
   */
  favoritesSearchFillByKeystroke: (keyword: string) => `
    set the clipboard to "${escapeAS(keyword)}"
    set wxProc to "WeChat"
    tell application "System Events"
      if not (exists process "WeChat") then
        if exists process "微信" then set wxProc to "微信"
      end if
      if not (exists process wxProc) then return "ERR_NO_WECHAT"
      tell process wxProc
        try
          keystroke "a" using command down
          delay 0.12
          key code 51
          delay 0.12
          keystroke "v" using command down
          delay 0.25
        on error errMsg
          return "ERR_KEYSTROKE:" & errMsg
        end try
      end tell
    end tell
    return "ok"
  `,

  /** 按 Esc 关闭当前最顶层窗口/sheet（用于搜索无结果时收掉收藏对话框）。 */
  closeDialogEsc: () => `
    set wxProc to "WeChat"
    tell application "System Events"
      if not (exists process "WeChat") then
        if exists process "微信" then set wxProc to "微信"
      end if
      if not (exists process wxProc) then return "ERR_NO_WECHAT"
      tell process wxProc
        set frontmost to true
        delay 0.1
        try
          key code 53
        end try
      end tell
    end tell
    return "ok"
  `,

  /**
   * 保留旧接口（已不再使用，走坐标直点方案）。
   */
  favoritesOperateDialog: (maxItems: number) => {
    const n = Math.min(20, Math.max(1, Math.floor(maxItems)))
    return `
    set wxProc to "WeChat"
    tell application "System Events"
      if not (exists process "WeChat") then
        if exists process "微信" then set wxProc to "微信"
      end if
      if not (exists process wxProc) then return "ERR_NO_WECHAT"
      tell process wxProc
        set frontmost to true
        delay 0.2
        set dlgElems to {}
        try
          set dlgElems to entire contents of window 1
        end try
        if (count of dlgElems) is 0 then
          return "ERR_FAVORITES_DIALOG"
        end if

        set locationClicked to false
        set idx to 0
        repeat with elem in dlgElems
          set idx to idx + 1
          if idx > 800 then exit repeat
          try
            set r to role of elem as string
            set txt to ""
            try
              set txt to name of elem as string
            end try
            if txt is "" then
              try
                set txt to value of elem as string
              end try
            end if
            if txt is "" then
              try
                set txt to description of elem as string
              end try
            end if
            if txt is "位置" and (r is "AXStaticText" or r is "AXCell" or r is "AXRow" or r is "AXButton") then
              try
                click elem
                set locationClicked to true
                exit repeat
              end try
            end if
          end try
        end repeat
        if locationClicked then
          delay 0.6
          try
            set dlgElems to entire contents of window 1
          end try
        end if

        -- 收集候选「可勾选项」：优先 AXCheckBox/AXRadioButton；兜底 AXRow/AXCell。
        -- 用 position.x 过滤掉左侧边栏（x 较小）。返回 JSON-ish 文本，由 TS 端用 nut-js 逐个点击行中心，
        -- 这样比 AppleScript click elem 更能真正触发圆圈的勾选（有些控件只响应鼠标事件）。
        set sidebarMaxX to 0
        set idx to 0
        repeat with elem in dlgElems
          set idx to idx + 1
          if idx > 1500 then exit repeat
          try
            set r to role of elem as string
            set txt to ""
            try
              set txt to name of elem as string
            end try
            if txt is "" then
              try
                set txt to value of elem as string
              end try
            end if
            if r is "AXStaticText" and (txt is "全部收藏" or txt is "位置" or txt is "标签") then
              try
                set posList to position of elem
                set px to item 1 of posList
                set sz to size of elem
                set sw to item 1 of sz
                if (px + sw) > sidebarMaxX then set sidebarMaxX to (px + sw)
              end try
            end if
          end try
        end repeat
        if sidebarMaxX is 0 then set sidebarMaxX to 180

        set itemLines to ""
        set itemCount to 0
        set roleStats to ""
        set idx to 0
        repeat with elem in dlgElems
          set idx to idx + 1
          if idx > 2000 then exit repeat
          if itemCount ≥ ${n} then exit repeat
          try
            set r to role of elem as string
            if r is "AXCheckBox" or r is "AXRadioButton" or r is "AXRow" or r is "AXCell" then
              try
                set posList to position of elem
                set px to item 1 of posList
                set py to item 2 of posList
                set sz to size of elem
                set sw to item 1 of sz
                set sh to item 2 of sz
                if px > sidebarMaxX and sw > 80 and sh > 20 then
                  set itemLines to itemLines & px & "," & py & "," & sw & "," & sh & "," & r & linefeed
                  set itemCount to itemCount + 1
                end if
              end try
            end if
          end try
        end repeat

        -- 无论成功与否，都顺带找出「发送」按钮坐标（给 TS 端用 nut-js 点击）
        set sendLine to ""
        set idx to 0
        repeat with elem in dlgElems
          set idx to idx + 1
          if idx > 1500 then exit repeat
          try
            set r to role of elem as string
            if r is "AXButton" then
              set nm to ""
              try
                set nm to name of elem as string
              end try
              set tt to ""
              try
                set tt to title of elem as string
              end try
              set s to nm & " " & tt
              if s contains "发送" or s contains "Send" then
                try
                  set posList to position of elem
                  set px to item 1 of posList
                  set py to item 2 of posList
                  set sz to size of elem
                  set sw to item 1 of sz
                  set sh to item 2 of sz
                  set sendLine to px & "," & py & "," & sw & "," & sh
                  exit repeat
                end try
              end if
            end if
          end try
        end repeat

        if itemCount is 0 then
          return "ERR_FAVORITES_NO_ITEMS|sidebarMaxX=" & sidebarMaxX
        end if
        return "ITEMS|sidebarMaxX=" & sidebarMaxX & "|send=" & sendLine & linefeed & itemLines
      end tell
    end tell
    `
  },

  checkUnread: `
    tell application "WeChat"
      activate
    end tell
    delay 0.3
    set unreadList to ""
    tell application "System Events"
      tell process "WeChat"
        try
          set mainWindow to window 1
          set allElements to entire contents of mainWindow
          repeat with elem in allElements
            try
              set elemRole to role of elem
              if elemRole is "AXStaticText" then
                set elemValue to value of elem
                if elemValue is not missing value and elemValue is not "" then
                  try
                    set numVal to elemValue as integer
                    if numVal > 0 and numVal < 1000 then
                      set parentElem to (first UI element of (value of attribute "AXParent" of elem))
                      try
                        set chatName to value of static text 1 of parentElem
                        if chatName is not elemValue then
                          set unreadList to unreadList & chatName & linefeed
                        end if
                      end try
                    end if
                  end try
                end if
              end if
            end try
          end repeat
        on error errMsg
          return "ERROR:" & errMsg
        end try
      end tell
    end tell
    return unreadList
  `
}

function escapeAS(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
