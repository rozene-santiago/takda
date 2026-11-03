// Self-hosted (server) build: data lives on the server, nothing to show.
// The hosted build swaps in save-status.hosted.tsx.
export function SaveStatus() {
  return null;
}

// Server build: backups are the data file on the server (see backup-now.bat).
export function SidebarBackupButton(_props: { onOpen?: () => void }) {
  return null;
}
