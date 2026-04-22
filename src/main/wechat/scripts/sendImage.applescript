-- Send an image file to the currently active chat by copying it to clipboard and pasting
-- Usage: osascript sendImage.applescript "/path/to/image.png"
on run argv
	if (count of argv) < 1 then
		error "Missing argument: image path"
	end if

	set imagePath to item 1 of argv

	-- Determine image type and copy to clipboard
	if imagePath ends with ".png" then
		set the clipboard to (read (POSIX file imagePath) as «class PNGf»)
	else if imagePath ends with ".jpg" or imagePath ends with ".jpeg" then
		set the clipboard to (read (POSIX file imagePath) as JPEG picture)
	else if imagePath ends with ".gif" then
		set the clipboard to (read (POSIX file imagePath) as GIF picture)
	else
		-- Try as generic image
		set the clipboard to (read (POSIX file imagePath) as «class PNGf»)
	end if

	delay 0.3

	tell application "WeChat"
		activate
	end tell
	delay 0.3

	tell application "System Events"
		tell process "WeChat"
			-- Paste the image
			keystroke "v" using command down
			delay 0.8

			-- Send (press Enter)
			keystroke return
			delay 0.5
		end tell
	end tell

	return "ok"
end run
