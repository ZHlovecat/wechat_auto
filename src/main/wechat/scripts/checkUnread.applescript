-- Check WeChat sidebar for chats with unread messages
-- Returns a newline-separated list of chat names that have unread badges
tell application "WeChat"
	activate
end tell
delay 0.3

set unreadList to ""

tell application "System Events"
	tell process "WeChat"
		try
			-- Try to access the chat list in the sidebar
			set mainWindow to window 1
			set allElements to entire contents of mainWindow

			-- Search for UI elements that might indicate unread badges
			-- WeChat 4.x structure varies, so we try multiple approaches
			repeat with elem in allElements
				try
					set elemRole to role of elem
					set elemDesc to description of elem
					-- Look for badge-like elements (static text with small numeric values)
					if elemRole is "AXStaticText" then
						set elemValue to value of elem
						if elemValue is not missing value and elemValue is not "" then
							-- Check if it looks like an unread count
							try
								set numVal to elemValue as integer
								if numVal > 0 and numVal < 1000 then
									-- Found an unread badge, get the parent's chat name
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
			-- If we can't access the UI tree, return empty
			return "ERROR:" & errMsg
		end try
	end tell
end tell

return unreadList
