# AI Learning Studio

`/learning-studio` (also the 🎓 button in the library HUD) turns a PDF of notes into a short narrated
lesson: animated visuals, captions, knowledge checks and an AI teacher that answers from the notes.

## Flow

1. **Upload**: `POST /api/learning-studio/extract` reads the PDF with `unpdf`. It accepts files up to 15 MB and
   120 pages, and rejects scanned or password-protected files with a clear message.
2. **Generate**: `POST /api/learning-studio/lessons` asks Gemini for JSON in the lesson schema
   (`lib/learning-studio/schema.ts`). Bad output gets one repair retry. Pages the notes don't have are dropped,
   and visuals can only name allow-listed templates.
3. **Play**: `components/learning-studio/LessonPlayer.tsx` plays the lesson. Narration uses ElevenLabs
   (`/api/learning-studio/tts`, with timestamps for exact captions) or, without a key, the browser's own
   voice with estimated captions.
4. **Ask**: `POST /api/learning-studio/chat` answers from the most relevant chunks of the notes and
   cites page numbers.

Lessons are saved in the browser (localStorage), not on a server.

## Lessons on the whiteboards

Any lesson can also play on one of the reading hall's rolling whiteboards, like a video the table
watches together:

1. Walk up to a rolling board (or sit at its table) and press **L** ("Play a lesson"). Pick one of
   your saved lessons or the built-in sample; "Make a new lesson" opens the studio in a new tab, and
   the list picks it up when you come back.
2. The board flips over on its pivots and the lesson appears on its other face.
3. Everyone within 6 m gets a card: **Join** (**J**) or **Not now** (**N**). Not joining leaves the
   lesson waiting on the board, showing where it got to; join later from the board's prompt (**J**).
   A board lesson only moves on while someone is joined.
4. Joined, you hear the narration and the board shows the live scene; like a video, each scene
   follows on by itself a moment after the last one ends (with no voice at all, the narration is
   shown as text and you move on yourself). A preview of the board sits in the bottom-left corner
   (hold **Shift** to click it while you're looking around). Knowledge checks pop up above it:
   answer with **1–4** and **Enter**, no need to free the mouse.
5. Click the preview (or press **F**) for the full lesson player: controls, captions, transcript,
   sources and the AI teacher, on the same playback, so nothing restarts. **Esc**, **F** or "Back to
   the library" shrinks it back into the corner.
6. **Leave lesson** (✕ on the preview) keeps it waiting on the board and counts as "Not now", so
   rejoin from the board's prompt (**J**); a finished lesson is taken off as you leave. **End
   lesson** (full screen, or **L** at the board) flips the board back. Editing your character pauses
   a joined lesson, and it carries on when you come back.

It's solo for now (the library has no other players yet). The board state is plain data in
`lib/learning-studio/boardLessons.ts` so the multiplayer phase can share it through the game server.
The screen side lives in `components/library/BoardLessons.tsx`.

## Setup

In `apps/web/.env.local`:

| Variable                                     | Needed | Notes                                                          |
| -------------------------------------------- | ------ | -------------------------------------------------------------- |
| `GEMINI_API_KEY`                             | yes    | Lessons and the AI teacher                                     |
| `GEMINI_LESSON_MODEL`                        | no     | Overrides the lesson model                                     |
| `ELEVENLABS_API_KEY`                         | no     | Human-sounding narration; without it the browser voice is used |
| `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` | no     | Defaults are in `.env.example`                                 |

Keys stay on the server; the browser only ever calls the `/api/learning-studio/*` routes.

## Not built yet

- Accounts and cloud storage (Supabase auth, private storage, row-level security). Lessons live in one browser.
- Background generation jobs. Generation is one long request (about 1–3 minutes, depending on Gemini).
- 3D models, label-the-diagram interactions, flashcards and quizzes.
