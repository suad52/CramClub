# Table timer (Pomodoro)

Every seat at a table comes with a little walnut LED desk clock for the Pomodoro Technique
(Francesco Cirillo's method, named after his tomato-shaped kitchen timer): pick a task, focus on it for one
pomodoro, take a short break, and after every fourth pomodoro take a longer one.

## Using it

1. **Sit at a table** (**E** at any seat). A digital clock pops onto the table in front of you, a
   little to the side away from the desk lamp, the view tilts down to your desk, and a timer card
   appears at the top left of the screen. The clock's display shows the time left as mm:ss, the
   phase (READY, FOCUS, BREAK, LONG BREAK), a progress bar and a dot for each pomodoro done in this
   set. Before you start it shows a whole pomodoro in amber (25:00 unless you've changed it).
2. **Say what you're working on.** Type it into "What are you working on?" on the card. It's
   step one of the method, and it stays until you change it.
3. **Press P** (or **Start focus**). Two quick beeps, every segment flashes, the display turns red
   and the library goes full screen. If you were in third person, the view switches to first
   person looking at your desk (your own shoulders would hide the clock from behind); **V**
   switches back, and standing up returns you to third person. The pomodoro has started: no pause button, so the
   only choices are to finish it or give it up.
4. **Work.** The clock counts down, its colon blinking each second; the card shows the same.
5. **The alarm goes** (beep-beep-beep-beep, twice; the clock flashes 00:00 and buzzes on the
   table) when the pomodoro is done. The display turns green for the break. A short break starts by itself:
   stand up, walk around, look at the books. The card stays at the top counting the break down,
   and the alarm goes again when the break is over, even if you've wandered off.
6. **Start the next one when you're ready** (**P**). Breaks end by themselves, but a pomodoro is
   always started on purpose. **Skip break** ends a break early.

The card shows where you are in the set (tomatoes filling up, e.g. 2 of 4) and how many pomodoros
you've finished today. Every fourth one earns a long break, and the long break starts a new set.
When you stand up from your seat, the clock shrinks away; it's back when you sit down again.

## Settings

The gear on the card:

| Setting          | Default | Range                | Notes                                                      |
| ---------------- | ------- | -------------------- | ---------------------------------------------------------- |
| Pomodoro         | 25 min  | 5–90 min, steps of 5 | The length of one pomodoro                                 |
| Short break      | 5 min   | 1–15 min             |                                                            |
| Long break       | 15 min  | 5–45 min, steps of 5 |                                                            |
| Long break every | 4       | 2–8 pomodoros        |                                                            |
| Strict           | On      | On / off             | Off is "gentle": see below                                 |
| Ticking sound    | Off     | On / off             | A soft tick each second while you focus (only in this tab) |
| Full screen      | On      | On / off             | Go full screen while a pomodoro runs                       |

A running pomodoro keeps the length and strictness it started with; changes to those apply to the
next one. The settings, your task and today's count are saved in this browser. A running
pomodoro is not: reloading or leaving the page ends it, and it doesn't count.

## The rules it follows

- **A pomodoro is indivisible.** It can't be paused. If it's interrupted for real (you leave the
  table, the library or, in strict mode, the tab for too long) it doesn't count; just start a new
  one.
- **Breaks start by themselves**, the next pomodoro is started by you.
- **A long break every fourth pomodoro** (or whatever you set), then a fresh set.
- **Today's count** is the number of pomodoros you finished today (one that rings after midnight
  counts for the new day).

## Staying at the table

While a pomodoro runs you're kept in your seat: the movement keys and **E** don't stand you up, and
a short message says why. The way out is **Leave table** on the card. It asks first, because
leaving ends the pomodoro early and it won't count. During breaks, and before you start, you
stand up as usual (**E** or any movement key).

## Staying in the tab

The point of a pomodoro is not switching away, so while one runs:

- **Full screen.** Starting a pomodoro goes full screen (unless you've turned that off) and leaves
  it again when the pomodoro ends. In Chrome and Edge a single press of **Esc** doesn't drop you
  out; hold **Esc** to leave full screen. Leaving full screen isn't leaving the tab.
- **Closing or reloading** the tab asks you first.
- **Things that would take you elsewhere wait:** the Learning Studio button and "Make a new lesson"
  (both open a new tab) are greyed out until after your pomodoro, as is Edit character in the
  pause menu. The pause menu's Leave asks first and gives up the pomodoro.
- **Leaving is noticed.** Switching to another tab or app, or the browser window losing focus,
  counts as leaving. The tab's title changes to call you back ("🍅 Come back — your pomodoro is
  running").

What happens next depends on the **Strict** setting:

| Mode             | Back within 10 seconds                                           | Away for longer than 10 seconds                                                                              |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Strict (default) | A warning; it counts as an interruption, the pomodoro carries on | The pomodoro is lost (the tab title says so while you're still away) and a card tells you when you come back |
| Gentle           | The timer waited for you                                         | The timer waited for you; it picks up where it stopped and tells you how long you were away                  |

In strict mode the clock keeps running while you're away; in gentle mode it stops. Breaks don't
care where you are.

## Sounds

All made in the browser, no sound files: two rising beeps when a pomodoro starts, an optional faint
tick while you focus, and an alarm-clock beep whenever a pomodoro or a break is over (it stays
quiet for one that ran out minutes before you came back to the library).

## What it can't do

- **It can't physically stop you leaving.** No web page can block switching tabs or apps, leaving
  full screen or closing the browser (the "Leave site?" question can always be answered "Leave").
  Instead it notices, and makes leaving cost the pomodoro (strict) or stop the clock (gentle).
- **Full screen and the Esc lock depend on the browser.** Without them (Safari, Firefox) one press
  of Esc leaves full screen; you're still in the tab, so the pomodoro carries on.
- **It's solo for now.** Nobody else in the library yet, so nobody sees your timer. The timer's
  state is plain data, ready for the multiplayer phases to show other players at your table what
  phase you're in.
- **Today's count lives in this browser**, not in an account.

## For developers

The rules are `apps/web/lib/game/pomodoro.ts`: pure transitions that each take `now`
(`startFocusPatch`, `tickPatch`, `awayPatch`, `backPatch`, `voidPatch`, `skipBreakPatch`,
`settingsPatch`) and the `usePomodoro` store that applies them. Its tests,
`apps/web/lib/game/pomodoro.test.ts`, walk through whole sets, strict and gentle leaving, the
grace period and settings with explicit times. Everything else reads that store; `rings` is bumped
each time a phase rings, which is what starts the alarm and the buzz.

- **The clock on the table:** `apps/web/components/world/PomodoroTimer.tsx` (built in code, no
  model file; the display is a canvas repainted only when what it shows changes). Where it
  stands: `apps/web/lib/world/tableTimer.ts`, whose
  tests check every seat's spot against the plan and the props in the shipped `library.glb`.
- **The card, notices and "Leave the table?":** `apps/web/components/library/Pomodoro.tsx`. Its
  `PomodoroDirector` runs the clock and holds you in the tab (leaving and coming back, full
  screen, "Leave site?", the title nudge, the sounds); `startPomodoro()` must be called straight
  from a click or key press, since browsers only allow full screen during one.
- **Staying at the table:** `isSeatLocked()` in `apps/web/lib/game/actions.ts`; `standUp()`
  refuses mid-pomodoro (tests: `apps/web/lib/game/seatLock.test.ts`).
- **The desk view:** `focusOnDesk()` in `actions.ts` (first person on start, third person back on
  standing up); the seated camera (`autoPitch`, `SEATED_DISTANCE`, your own chair ignored by
  `isCameraBlocked`) is in `CameraRig.tsx`.
- **Sounds:** `playTimerStart`, `playTimerTick` and `playTimerAlarm` in `apps/web/lib/game/sfx.ts`.
