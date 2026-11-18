# Invitation recovery

The invitation button formerly depended on the URL fragment alone. Returning through `/` restored room membership from `draftroom-current`, but lost the fragment and hid the button.

Shared rooms now always expose Copy invitation. Valid tokens are remembered per authenticated identity and room slug, restored when re-entering the room, and removed on leaving. Local demo rooms still have no invitation button. The browser's connection status is separate from copy feedback.

For rooms resumed without a cached token, `issue_room_invitation` checks membership and issues an additional valid invitation. Only its hash is stored in the private invitation table. Earlier links continue working; copying does not change the room state, draft version or history. Membership is required even for observers, and former members and outsiders are denied. Invitations are bounded to 100 per room and removed with the room.

When clipboard permission or browser gesture restrictions prevent copying, a dialog exposes the selected link for manual copying. No invitation is sent automatically.
