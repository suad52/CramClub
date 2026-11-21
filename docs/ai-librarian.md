# The AI Librarian (TinyFish + Gemini + Tiger Data)

Ms. Ada Fenwick stands behind the circulation desk under the north gallery. Tell her what you want to
learn and she:

1. **researches the live web with TinyFish**;
2. **organises what TinyFish actually read** into source cards;
3. **writes a study plan** (Gemini);
4. **turns the research into an interactive lesson** that plays in the existing lesson player.

All of it is recorded in Tiger Data alongside the rest of your learning.

## Using it

- **Open her:**
  - walk up to the desk and press **E**;
  - or use **Ask the Librarian** in the library's top bar;
  - or go to `/librarian`, which works without the 3D library.
- **Ask in your own words**, or pick a starter ("Help me study for an upcoming exam", …). If
  something essential is missing, such as an exam date or daily time for a plan, she asks. At most two
  questions.
- **She says what she'll do and waits.** **Start research** runs one of two modes:
  - **Quick** (about a minute): TinyFish Search, then TinyFish Fetch of the most promising pages.
    Both are free up to their daily allowances.
  - **Deep** (5–20 minutes): a TinyFish Research run. It costs TinyFish credits ($2 a run) and is
    for bigger questions.
- **The activity panel shows only what TinyFish confirmed**: the searches it ran, the pages it read
  and the pages it couldn't. You can cancel at any time.
- **Results:**
  - an overview;
  - key concepts;
  - **source cards**: title, site, type, summary, why it helps and the date accessed, plus **Open**
    and **Save**;
  - honest warnings when the evidence is thin.
- **Study plan:**
  - days with activities, minutes, completion criteria and the researched resources;
  - **Complete** (+10 XP, once per item, at most 12 a day), **Skip**, **Reopen** and **Reschedule**;
  - **Start lesson** on lesson and review items.
- **Interactive lesson:** built from the sources (each source is a "page", so the scenes' source
  references point back to real URLs). It plays in the Learning Studio's player, with narration,
  knowledge checks and the AI teacher. Lesson, quiz and pomodoro events count towards My Progress and
  the leaderboard as usual.
- **Home:** your recent requests, saved sources, **Next up** (your next open plan item) and a
  data-grounded nudge from Tiger Data, such as your weakest first-try quiz accuracy or this week's
  focus time.

## Studying from your notes

Upload your own lecture notes and she builds the study material around them, with no
confirmation step: uploading the files and choosing what to make is the go-ahead.

- **What you upload:** 1–3 files, each a PDF with selectable text, a `.txt` or a `.md` file, up to
  15 MB each. You can add a message (up to 1,000 characters, e.g. "the midterm is on cyclic
  electron flow, I'm fine on pigments"), what to make (**plan**, **lesson** or **both**) and, for a
  plan, an exam date and minutes a day.
- **What happens, in the activity panel:**
  1. **The server extracts the text.** PDFs go through the Learning Studio's extractor, one entry
     per page. Text files are split into pages of about 3,000 characters. "Read lecture3.pdf ·
     12 pages".
  2. **Gemini reads the notes** (status "Gemini is reading your notes"): the topic, subject and
     level, a short summary, an outline, the key concepts, and the **gaps**, meaning what the notes
     mention without explaining or the background they assume. From those it writes up to 3 web
     searches. If the upload isn't study material, or asks for work to hand in, she says so kindly
     and stops there.
  3. **TinyFish reads the web.** It opens the links found in the notes (up to 4, http(s) only, no
     answer-sharing or social sites) and runs the searches. Then it reads the best pages, as in quick
     research. **TinyFish never sees your file.** It's a web search and fetch agent: Gemini reads the
     notes, and what Gemini finds there decides what TinyFish looks up.
  4. **Gemini checks the sources** against the notes' summary and outline, and keeps the ones that
     fill the gaps. If nothing reliable turns up, she carries on from your notes alone and says so.
  5. **The plan and/or the lesson:**
     - **Plan:** built around the notes' outline. It includes "Review your notes: <section>"
       items, and its resource links are only the researched URLs.
     - **Lesson:** your notes come first, in page order, then up to 4 web sources. In the lesson's
       sources a notes page appears as "Your notes: lecture3.pdf, p. 4", with no link.
     - **Both:** the plan first, then the lesson.
- **Long notes:** at most 200,000 characters are kept per upload, shared fairly between the
  files. A lesson uses about 30,000 characters of notes: every page, trimmed, or pages spread
  through the notes when there are too many. A warning says so whenever that happens.
- **Timing:** a one-page note took about 30 seconds end to end for both outcomes in testing (Nov
  2026).
- **Cancel and retry:**
  - **Cancel** stops the work between steps.
  - **Retry** picks up where it stopped: reading the notes, the research, the plan (then the lesson,
    if both were asked for) or the lesson.
  - Work that hasn't moved in 4 minutes is marked failed and can be retried.
  - When Gemini is overloaded (both models), the error says so (`ai_busy`) and nothing is lost.

**Where the notes go:**

- Only the extracted text is kept, never the file. It's stored in Tiger Data in `librarian_notes`,
  one row per file with its pages, alongside the request.
- It's **deleted with the request, and with the learner** (`ON DELETE CASCADE` on both).
- It's sent to Gemini (to read it and build the lesson), and to nobody else.
- In every prompt the notes are wrapped as untrusted data, and the model is told never to follow
  instructions inside them, like scraped pages. Notes are not `research_sources`: only web pages
  are.

## Her voice (ElevenLabs)

With `ELEVENLABS_API_KEY` set, she **speaks her replies** and says hello the first time you
open her on a visit, and her **jaw follows the audio's loudness** (Web Audio analyser). Without a
key she mouths them as before. Only whole sentences up to about 320 characters are spoken (her
replies, never long overviews), audio is cached on the server, and a **Voice on/off** toggle in
her panel is remembered in the browser. Her voice is `ELEVENLABS_LIBRARIAN_VOICE_ID`, or a warm
British premade voice by default; if that voice isn't on the account, the lesson narrator's voice
(`ELEVENLABS_VOICE_ID`) is used. The same key gives every lesson (Learning Studio, whiteboards and
the Librarian's lessons) ElevenLabs narration with word-timed captions instead of the browser voice.

### Talking to her (push-to-talk)

The 🎤 button next to Send: tap, speak, tap ■. The recording goes to `POST /api/librarian/listen`,
which forwards it to ElevenLabs Speech to Text (`scribe_v2`) and returns the words. The audio isn't
kept. What she heard goes into the message box so you can check it, then Enter sends it. The
microphone is only on while recording, at most 30 s. The ElevenLabs key needs **Text to Speech**
and **Speech to Text** access, and nothing else.

**Free ElevenLabs plans can't use "library" voices through the API** (402 `paid_plan_required`).
Tested on 2026-11-20:

- **Works on free:** Lily (her default), Sarah (the lessons' default narrator), Matilda, Alice,
  George and Daniel.
- **Paid only:** Rachel and Charlotte.

## Who does what

| Step                                                         | Provider     | How                                                                                                                                                               |
| ------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Understanding the request, follow-up questions, confirmation | Gemini       | JSON schema, validated with zod                                                                                                                                   |
| Reading uploaded notes (outline, gaps, searches)             | Gemini       | Over the extracted text, wrapped as untrusted data. TinyFish never gets the file, only the links in it and the searches Gemini wrote.                             |
| Searching and reading the web                                | **TinyFish** | Search (`api.search.tinyfish.ai`), Fetch (`api.fetch.tinyfish.ai`), Research (`agent.tinyfish.ai/v1/automation/run-research-async` + `GET /v1/research-run/{id}`) |
| Choosing and summarising sources                             | Gemini       | Over the fetched pages only, wrapped as untrusted data. Never follows instructions found in them, never invents sources.                                          |
| Study plan                                                   | Gemini       | Validated: dates inside the plan, only researched URLs, workload warnings                                                                                         |
| Lesson                                                       | Gemini       | The Learning Studio's `generateLesson`, with sources as pages                                                                                                     |
| Learning record, XP, insights                                | Tiger Data   | `learning_events` hypertable (new types: `research_completed`, `resource_saved`, `study_plan_created`, `plan_item_completed`) + relational tables                 |

The TinyFish adapter, `apps/web/lib/librarian/server/tinyfish.ts`, is the only code that knows
TinyFish's request and response shapes. Everything else uses the app-level types in
`apps/web/lib/librarian/types.ts`.

## Setup

1. **TinyFish key:** create one at [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys).
   For the hackathon there are free student credits at tinyfish.ai/students. Put it in
   `apps/web/.env.local` and never commit it:
   ```
   TINYFISH_API_KEY=...
   ```
   Search is free up to 12,000 requests a day and Fetch up to 1,000 URLs a day. Deep research needs
   wallet credits.
2. **Other settings:** `GEMINI_API_KEY`, `DATABASE_URL` and `LEARNER_SECRET` are already set up (see
   [learning-analytics.md](learning-analytics.md)).
3. **Tables:** `pnpm --filter web db:migrate` applies `0002_librarian.sql`: `librarian_tasks`,
   `research_sources`, `study_plans` and `study_plan_items`, plus the new event types. It also
   applies `0003_librarian_notes.sql`: the `study_from_notes` request type and `librarian_notes`.
4. **Optional:** `GEMINI_LIBRARIAN_MODEL` picks the Librarian's model. It defaults to the fast
   fallback model, so she answers in seconds. When this was written, the default text model
   (`gemini-4-hydrogen`) was timing out after 30 s while `gemini-3.5-flash-lite` answered in half a
   second.

Without `TINYFISH_API_KEY`, she still understands requests and shows your saved items and plans,
but **Start research** says what's missing instead of pretending. No mock results are ever shown as
real.

## API

Same-origin. The learner comes from the verified Auth0 session when signed in, else the signed
cookie ([auth0.md](auth0.md)), and every row is looked up with their id.
`app/api/librarian/[...path]/route.ts`:

- `GET home`
- `POST tasks`
- `GET tasks/:id`, which the client polls while busy. It advances deep runs and fails work that has
  died.
- `POST tasks/:id/confirm|cancel|retry|plan|lesson`
- `POST resources/:id`
- `POST plan-items/:id`
- `POST notes`, as multipart form data:
  - **Fields:** `files` (repeated, 1–3), `message?` (≤ 1,000 characters),
    `outcome` (`plan` | `lesson` | `both`), `examDate?` (`YYYY-MM-DD`) and `minutesPerDay?`
    (10–600).
  - **Success:** `200` with the task (`study_from_notes`, status `reading_notes`, `busy`). Poll it
    like any other.
  - **Errors:** plain, specific messages:
    - `400` for a wrong type, an empty file, a fake PDF (no `%PDF-` header), text that isn't UTF-8,
      too many files, a bad field, or no extractable text (`no_text`: scanned PDFs can't be read
      yet);
    - `413` for a file over 15 MB;
    - `429` after 6 accepted uploads in 10 minutes;
    - `503` without `TINYFISH_API_KEY` or `GEMINI_API_KEY`.

Long work runs after the response with Next's `after()`. A notes request runs its whole pipeline
in one `after()`. That's fine in `next dev`. On a host that enforces `maxDuration` (300 s), a very
slow lesson could be cut off; the 4-minute stale check then marks it failed, with a retry.

**Errors and timeouts:**

- **TinyFish errors** (401 key, 402 credits, 429 busy, network/timeout) become a clear, retryable
  message, and your request is kept.
- **Gemini failures** keep the sources and offer a retry of just the plan or lesson.
- **Stuck work:** quick work that hasn't moved in 4 minutes, or deep work older than 50 minutes, is
  marked failed with a retry.

## Safety

- **Keys:** TinyFish, Gemini and database keys stay on the server.
- **Untrusted pages:** scraped text is treated as data, wrapped and labelled, and the model is told
  never to follow instructions inside it.
- **Blocked sites:** answer-selling sites (Chegg, Course Hero, Studocu, Brainly, …) are never
  recommended. Credible domains (.edu, .gov, OpenStax, Khan Academy, LibreTexts, NIH, …) rank first.
- **Copyright:** only short summaries are shown. Each source's extracted text (up to 4,000 characters)
  is kept server-side only to ground the lesson.
- **Academic honesty:** requests to write work to hand in are kindly declined, with an offer to help
  the student understand and study instead.
- **Privacy:** no course-portal passwords, no logins bypassed. Course-page monitoring (spec workflow
  D) is **not built**. It needs explicit opt-in, a scheduler and TinyFish monitoring, and comes after
  the core flow.

## Demo (Hack Western)

1. Walk to the desk and press **E**. She waves, and her eyes follow you.
2. Type: "I have a biology exam in seven days. I need to learn photosynthesis and cellular
   respiration. I understand photosynthesis better, and I can study for 45 minutes a day."
3. She confirms the plan of action. Press **Start research**: the activity panel lists TinyFish's
   real searches and the pages it read.
4. The source cards appear. Since it's a study-plan request, the 7-day plan follows, with extra time
   for cellular respiration.
5. **Start lesson** on a lesson item, play it and answer a knowledge check.
6. Open **My Progress**: the lesson, quiz and plan-item XP are in Tiger Data. The Librarian's home
   shows "Next up".
