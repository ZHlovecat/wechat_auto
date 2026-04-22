-- Send a text message to the currently active chat, typing char-by-char (human-like)
-- Usage: osascript sendMessage.applescript "消息内容"
on run argv
	if (count of argv) < 1 then
		error "Missing argument: message text"
	end if

	set messageText to item 1 of argv

	tell application "WeChat"
		activate
	end tell
	delay 0.35

	tell application "System Events"
		tell process "WeChat"
			set frontmost to true
			delay 0.15
			-- Focus the input area
			try
				set inputArea to text area 1 of scroll area 1 of group 1 of splitter group 1 of window 1
				click inputArea
				delay 0.2
			on error
				set winPos to position of window 1
				set winSize to size of window 1
				set xClick to (item 1 of winPos) + ((item 1 of winSize) / 2)
				set yClick to (item 2 of winPos) + (item 2 of winSize) - 80
				click at {xClick, yClick}
				delay 0.2
			end try

			-- Type character by character via single-char clipboard pastes (handles CJK / emoji)
			set n to count of messageText
			repeat with i from 1 to n
				set ch to character i of messageText
				if ch is return or ch is linefeed then
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
end run
