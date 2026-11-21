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

## Who does what

| Step                                                         | Provider     | How                                                                                                                                                               |
| ------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Understanding the request, follow-up questions, confirmation | Gemini       | JSON schema, validated with zod                                                                                                                                   |
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
   `research_sources`, `study_plans` and `study_plan_items`, plus the new event types.
4. **Optional:** `GEMINI_LIBRARIAN_MODEL` picks the Librarian's model. It defaults to the fast
   fallback model, so she answers in seconds. When this was written, the default text model
   (`gemini-4-hydrogen`) was timing out after 30 s while `gemini-3.5-flash-lite` answered in half a
   second.

Without `TINYFISH_API_KEY`, she still understands requests and shows your saved items and plans,
but **Start research** says what's missing instead of pretending. No mock results are ever shown as
real.

## API

Same-origin. The learner comes from the signed cookie, and every row is looked up with their id.
`app/api/librarian/[...path]/route.ts`:

- `GET home`
- `POST tasks`
- `GET tasks/:id`, which the client polls while busy. It advances deep runs and fails work that has
  died.
- `POST tasks/:id/confirm|cancel|retry|plan|lesson`
- `POST resources/:id`
- `POST plan-items/:id`

Long work runs after the response with Next's `after()`.

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
