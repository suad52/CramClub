/**
 * What the Librarian's panel tells the librarian in the 3D library, read every frame by
 * components/world/Librarian.tsx. Plain mutable data (no store): it changes often and nothing
 * re-renders from it.
 *
 * - `open`: her panel is showing, so she keeps her eyes on you.
 * - `working`: a request is busy (researching, writing a plan or a lesson): she writes in her ledger.
 * - `speakUntil`: a `performance.now()` time; until then she's talking (a new reply just arrived).
 */
export const librarianPresence = { open: false, working: false, speakUntil: 0 };

/** How long she "says" each new reply. */
export const SPEAK_MS = 2200;
