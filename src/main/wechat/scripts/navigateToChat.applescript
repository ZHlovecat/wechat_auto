-- Navigate to a specific chat by searching for the contact/group name
-- Usage: osascript navigateToChat.applescript "联系人名称"
on run argv
	if (count of argv) < 1 then
		error "Missing argument: chat name"
	end if

	set targetChat to item 1 of argv

	tell application "WeChat"
		activate
	end tell
	delay 0.3

	tell application "System Events"
		tell process "WeChat"
			-- Use Cmd+F to open search
			keystroke "f" using command down
			delay 0.5

			-- Clear existing search text
			keystroke "a" using command down
			delay 0.1

			-- Type the contact/group name
			keystroke targetChat
			delay 1

			-- Press Enter to select the first result
			keystroke return
			delay 0.5
		end tell
	end tell

	return "ok"
end run
