// Placeholder entry for the kanban board window (board.html). Task 3.2 replaces
// this with the real Kanban React app. It exists now so `vite build` can resolve
// board.html's module graph and emit dist/board.html (the window loads it via
// WebviewUrl::App("board.html")).
const root = document.getElementById("board-root");
if (root) root.textContent = "Outreach Board — loading…";
